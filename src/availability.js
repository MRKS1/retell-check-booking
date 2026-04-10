const { CONFIG } = require("./config");
const {
  createAppointmentRegistryEntry,
  deleteAppointmentRegistryEntry,
  finalizeRescheduleTransition,
  getAppointmentRegistryById,
  getManageableAppointmentByCodeHash,
  markAppointmentRegistryCancelled,
  markAppointmentRegistryRollbackFailed,
  updateAppointmentRegistrySmsDelivery
} = require("./db");
const {
  createManageCode,
  hashManageCode,
  validateManageCode
} = require("./manage-codes");
const { getCalendarProvider } = require("./providers");
const { deliverManageCode } = require("./sms");
const {
  addDaysInTimeZone,
  formatDateOnlyInTimeZone,
  formatDateTimeInTimeZone,
  getStartOfDayInTimeZone,
  getTimeZoneParts,
  makeDateInTimeZone
} = require("./timezone");

function parseMinutes(timeValue) {
  const [hours, minutes] = timeValue.split(":").map(Number);
  return (hours * 60) + minutes;
}

function setTimeForDate(date, timeValue) {
  const parts = getTimeZoneParts(date, CONFIG.timezone);
  const [hours, minutes] = timeValue.split(":").map(Number);
  return makeDateInTimeZone({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: hours,
    minute: minutes,
    second: 0
  }, CONFIG.timezone);
}

function formatDateTimeLocal(date) {
  return formatDateTimeInTimeZone(date, CONFIG.timezone);
}

function formatDateOnly(date) {
  return formatDateOnlyInTimeZone(date, CONFIG.timezone);
}

function isDateTimeInPast(date) {
  return date.getTime() < Date.now();
}

function isDateInPastForClinicDay(date) {
  return formatDateOnly(date) < formatDateOnly(new Date());
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function getBusinessHoursForDate(date) {
  const { weekday } = getTimeZoneParts(date, CONFIG.timezone);
  return CONFIG.businessHours[weekday];
}

function getAppointmentsForDay(appointments, date) {
  const dateOnly = formatDateOnly(date);
  return appointments.filter((appointment) => appointment.start_time.startsWith(dateOnly));
}

function getServiceConfig(serviceName) {
  if (!serviceName || !CONFIG.services[serviceName]) {
    return null;
  }

  return CONFIG.services[serviceName];
}

function getValidServiceNames() {
  return Object.keys(CONFIG.services);
}

function validateService(serviceName) {
  if (!serviceName) {
    return {
      ok: false,
      error: `Missing required field: service. Valid values: ${getValidServiceNames().join(", ")}`
    };
  }

  if (!getServiceConfig(serviceName)) {
    return {
      ok: false,
      error: `Unknown service: ${serviceName}. Valid values: ${getValidServiceNames().join(", ")}`
    };
  }

  return { ok: true };
}

function validateDateInput(value) {
  if (value === undefined || value === null) {
    return { ok: true };
  }

  if (typeof value !== "string") {
    return {
      ok: false,
      error: "Invalid date format. Use YYYY-MM-DD."
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return {
      ok: false,
      error: "Invalid date format. Use YYYY-MM-DD."
    };
  }

  return { ok: true };
}

function validateStartTimeInput(value, fieldName = "start_time") {
  if (value === undefined || value === null) {
    return { ok: true };
  }

  if (typeof value !== "string") {
    return {
      ok: false,
      error: `Invalid ${fieldName} format. Use ISO 8601.`
    };
  }

  if (!value.match(/([+-]\d{2}:\d{2}|Z)$/)) {
    return {
      ok: false,
      error: `Invalid ${fieldName}: timezone offset is required (e.g. '2026-04-10T09:00:00+02:00'). Received: ${value}`
    };
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      error: `Invalid ${fieldName} format. Use ISO 8601.`
    };
  }

  return {
    ok: true,
    value,
    parsed
  };
}

function isSameInstant(isoA, isoB) {
  const a = new Date(isoA);
  const b = new Date(isoB);

  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    return false;
  }

  return a.getTime() === b.getTime();
}

function isTimeInServiceWindows(serviceConfig, requestedStart, requestedEnd) {
  for (const [windowStart, windowEnd] of serviceConfig.timeWindows) {
    const dayStart = setTimeForDate(requestedStart, windowStart);
    const dayEnd = setTimeForDate(requestedStart, windowEnd);
    if (requestedStart >= dayStart && requestedEnd <= dayEnd) {
      return true;
    }
  }

  return false;
}

function getServiceTimeWindowsDescription(serviceConfig) {
  return serviceConfig.timeWindows
    .map(([start, end]) => `${start}–${end}`)
    .join(", ");
}

function filterExcludedAppointments(appointments, excludedAppointmentIds = []) {
  const excludedIds = new Set((excludedAppointmentIds || []).filter(Boolean));

  if (excludedIds.size === 0) {
    return appointments;
  }

  return appointments.filter((appointment) => {
    return !excludedIds.has(appointment.id) && !excludedIds.has(appointment.provider_appointment_id);
  });
}

function generateSlotsForWindow(date, windowStart, windowEnd, durationMinutes, intervalMinutes, appointmentsForDay) {
  const startMinutes = parseMinutes(windowStart);
  const endMinutes = parseMinutes(windowEnd);
  const slots = [];

  for (
    let currentMinutes = startMinutes;
    currentMinutes + durationMinutes <= endMinutes;
    currentMinutes += intervalMinutes
  ) {
    const dateParts = getTimeZoneParts(date, CONFIG.timezone);
    const slotStart = makeDateInTimeZone({
      year: dateParts.year,
      month: dateParts.month,
      day: dateParts.day,
      hour: Math.floor(currentMinutes / 60),
      minute: currentMinutes % 60,
      second: 0
    }, CONFIG.timezone);

    const slotEnd = new Date(slotStart.getTime() + (durationMinutes * 60 * 1000));
    const isBusy = appointmentsForDay.some((appointment) => {
      const bookingStart = new Date(appointment.start_time);
      const bookingEnd = new Date(appointment.end_time);
      return overlaps(slotStart, slotEnd, bookingStart, bookingEnd);
    });

    if (!isBusy) {
      slots.push({
        start: formatDateTimeLocal(slotStart),
        end: formatDateTimeLocal(slotEnd)
      });
    }
  }

  return slots;
}

function generateSlotsForService(date, serviceName, appointments) {
  const businessHours = getBusinessHoursForDate(date);
  if (!businessHours) return [];

  const serviceConfig = getServiceConfig(serviceName);
  if (!serviceConfig) return [];

  const appointmentsForDay = getAppointmentsForDay(appointments, date);

  if (serviceConfig.maxPerDay !== null) {
    const existingCount = appointmentsForDay.filter((appointment) => appointment.service === serviceName).length;
    if (existingCount >= serviceConfig.maxPerDay) return [];
  }

  const allSlots = [];

  for (const [windowStart, windowEnd] of serviceConfig.timeWindows) {
    const windowSlots = generateSlotsForWindow(
      date,
      windowStart,
      windowEnd,
      serviceConfig.durationMinutes,
      serviceConfig.intervalMinutes,
      appointmentsForDay
    );
    allSlots.push(...windowSlots);
  }

  return allSlots.map((slot, index) => ({
    ...slot,
    order_number: index + 1
  }));
}

function generateSlotsForDate(date, durationMinutes, appointments) {
  const businessHours = getBusinessHoursForDate(date);
  if (!businessHours) return [];

  const [startTime, endTime] = businessHours;
  const appointmentsForDay = getAppointmentsForDay(appointments, date);

  return generateSlotsForWindow(
    date,
    startTime,
    endTime,
    durationMinutes,
    CONFIG.slotIntervalMinutes,
    appointmentsForDay
  );
}

function findNextAvailableSlotsForService(startDate, serviceName, appointments) {
  const suggestions = [];
  let cursor = getStartOfDayInTimeZone(startDate, CONFIG.timezone);
  let daysChecked = 0;

  while (suggestions.length < CONFIG.maxSuggestions && daysChecked < CONFIG.availabilitySearchDays) {
    const slots = generateSlotsForService(cursor, serviceName, appointments);
    suggestions.push(...slots);
    cursor = addDaysInTimeZone(cursor, 1, CONFIG.timezone);
    daysChecked++;
  }

  return suggestions.slice(0, CONFIG.maxSuggestions);
}

function findNextAvailableSlots(startDate, durationMinutes, appointments) {
  const suggestions = [];
  let cursor = getStartOfDayInTimeZone(startDate, CONFIG.timezone);

  while (suggestions.length < CONFIG.maxSuggestions) {
    const slots = generateSlotsForDate(cursor, durationMinutes, appointments);
    suggestions.push(...slots);
    cursor = addDaysInTimeZone(cursor, 1, CONFIG.timezone);
  }

  return suggestions.slice(0, CONFIG.maxSuggestions);
}

function getSearchWindow(anchorDate) {
  const startDate = getStartOfDayInTimeZone(anchorDate, CONFIG.timezone);
  const endDate = addDaysInTimeZone(startDate, CONFIG.availabilitySearchDays, CONFIG.timezone);

  return {
    startDate,
    endDate
  };
}

async function getStoredAppointments({ anchorDate = new Date(), providerName = CONFIG.calendarProvider } = {}) {
  const provider = getCalendarProvider(providerName);
  const searchWindow = getSearchWindow(anchorDate);

  return provider.listAppointments({
    startDate: searchWindow.startDate,
    endDate: searchWindow.endDate
  });
}

function createAppointmentId() {
  return `appt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getProviderAppointmentId(appointment) {
  return appointment.provider_appointment_id || appointment.id;
}

function getAppointmentLabel(serviceName) {
  const serviceConfig = getServiceConfig(serviceName);
  return serviceConfig ? serviceConfig.label : serviceName;
}

function buildAppointmentSummary(appointment) {
  return `${getAppointmentLabel(appointment.service)} at ${appointment.start_time}`;
}

function buildManageCodeDeliveryResult(deliveryResult) {
  return {
    mode: deliveryResult.mode,
    sms_status: deliveryResult.sms_status,
    sms_provider: deliveryResult.provider,
    speech: deliveryResult.speech,
    sms_error: deliveryResult.error
  };
}

function createRegistryEntry({ appointment, providerName, manageCodeHmac, status }) {
  const createdAt = appointment.created_at || new Date().toISOString();

  return {
    appointment_id: appointment.id,
    provider: providerName,
    provider_appointment_id: getProviderAppointmentId(appointment),
    customer_name: appointment.customer_name || null,
    customer_phone: appointment.customer_phone || null,
    customer_email: appointment.customer_email || null,
    service: appointment.service,
    start_time: appointment.start_time,
    end_time: appointment.end_time,
    notes: appointment.notes || null,
    status,
    manage_code_hmac: manageCodeHmac || null,
    created_at: createdAt,
    updated_at: createdAt,
    replaced_by_appointment_id: null,
    sms_delivery_status: null,
    sms_last_error: null
  };
}

async function persistManageCodeDelivery({ appointmentId, manageCode, appointment }) {
  const deliveryResult = await deliverManageCode({
    manageCode,
    appointment
  });

  updateAppointmentRegistrySmsDelivery({
    appointmentId,
    smsDeliveryStatus: deliveryResult.sms_status,
    smsLastError: deliveryResult.error,
    updatedAt: new Date().toISOString()
  });

  return buildManageCodeDeliveryResult(deliveryResult);
}

function getManageCodeLookupError() {
  return {
    ok: false,
    error: "No active booking found for the provided manage_code."
  };
}

function getManageableAppointmentFromPayload(payload) {
  const validation = validateManageCode(payload.manage_code);

  if (!validation.ok) {
    return validation;
  }

  const record = getManageableAppointmentByCodeHash(hashManageCode(validation.manageCode));

  if (!record) {
    return getManageCodeLookupError();
  }

  // Check if appointment is in pending_reschedule state
  if (record.status === 'pending_reschedule') {
    return {
      ok: false,
      error: "Appointment is currently being rescheduled. Please try again in a moment.",
      manageable: false
    };
  }

  return {
    ok: true,
    manageCode: validation.manageCode,
    record
  };
}

async function rollbackCreatedAppointment(providerName, appointment) {
  const provider = getCalendarProvider(providerName);
  const providerAppointmentId = getProviderAppointmentId(appointment);

  try {
    return await provider.cancelAppointment({
      appointmentId: providerAppointmentId
    });
  } catch (error) {
    return false;
  }
}

async function checkAvailability(payload) {
  const providerName = payload.provider_name || CONFIG.calendarProvider;
  const serviceName = payload.service;
  const serviceValidation = validateService(serviceName);

  if (!serviceValidation.ok) {
    return serviceValidation;
  }

  const dateValidation = validateDateInput(payload.date);
  if (!dateValidation.ok) {
    return dateValidation;
  }

  const startTimeValidation = validateStartTimeInput(payload.start_time, "start_time");
  if (!startTimeValidation.ok) {
    return startTimeValidation;
  }

  const serviceConfig = getServiceConfig(serviceName);
  const durationMinutes = serviceConfig.durationMinutes;
  const excludedAppointmentIds = payload.exclude_appointment_ids || [];

  if (!payload.date && !payload.start_time) {
    const now = new Date();
    const appointments = filterExcludedAppointments(
      await getStoredAppointments({ anchorDate: now, providerName }),
      excludedAppointmentIds
    );

    return {
      ok: true,
      available: false,
      reason: "No exact date/time provided. Returning next available slots.",
      service: serviceName,
      patient_info: serviceConfig.patientInfo,
      provider: providerName,
      duration_minutes: durationMinutes,
      timezone: CONFIG.timezone,
      available_slots: [],
      next_available_slots: findNextAvailableSlotsForService(now, serviceName, appointments)
    };
  }

  if (payload.start_time) {
    const requestedStart = startTimeValidation.parsed;

    if (isDateTimeInPast(requestedStart)) {
      const now = new Date();
      const appointments = filterExcludedAppointments(
        await getStoredAppointments({ anchorDate: now, providerName }),
        excludedAppointmentIds
      );

      return {
        ok: true,
        available: false,
        reason: "Requested start_time is in the past.",
        service: serviceName,
        patient_info: serviceConfig.patientInfo,
        provider: providerName,
        requested_start: formatDateTimeLocal(requestedStart),
        next_available_slots: findNextAvailableSlotsForService(now, serviceName, appointments)
      };
    }

    const appointments = filterExcludedAppointments(
      await getStoredAppointments({ anchorDate: requestedStart, providerName }),
      excludedAppointmentIds
    );
    const requestedEnd = new Date(requestedStart.getTime() + (durationMinutes * 60 * 1000));
    const businessHours = getBusinessHoursForDate(requestedStart);

    if (!businessHours) {
      return {
        ok: true,
        available: false,
        reason: "Outside business days",
        service: serviceName,
        patient_info: serviceConfig.patientInfo,
        provider: providerName,
        requested_start: formatDateTimeLocal(requestedStart),
        next_available_slots: findNextAvailableSlotsForService(requestedStart, serviceName, appointments)
      };
    }

    if (!isTimeInServiceWindows(serviceConfig, requestedStart, requestedEnd)) {
      return {
        ok: true,
        available: false,
        reason: `Outside time window for ${serviceConfig.label}. Available: ${getServiceTimeWindowsDescription(serviceConfig)}.`,
        service: serviceName,
        patient_info: serviceConfig.patientInfo,
        provider: providerName,
        requested_start: formatDateTimeLocal(requestedStart),
        service_time_windows: getServiceTimeWindowsDescription(serviceConfig),
        next_available_slots: findNextAvailableSlotsForService(requestedStart, serviceName, appointments)
      };
    }

    const appointmentsForDay = getAppointmentsForDay(appointments, requestedStart);

    if (serviceConfig.maxPerDay !== null) {
      const serviceCount = appointmentsForDay.filter((appointment) => appointment.service === serviceName).length;
      if (serviceCount >= serviceConfig.maxPerDay) {
        return {
          ok: true,
          available: false,
          reason: `Maximum ${serviceConfig.maxPerDay} ${serviceConfig.label} per day already booked.`,
          service: serviceName,
          patient_info: serviceConfig.patientInfo,
          provider: providerName,
          requested_start: formatDateTimeLocal(requestedStart),
          next_available_slots: findNextAvailableSlotsForService(requestedStart, serviceName, appointments)
        };
      }
    }

    const isBusy = appointmentsForDay.some((appointment) => {
      return overlaps(
        requestedStart,
        requestedEnd,
        new Date(appointment.start_time),
        new Date(appointment.end_time)
      );
    });

    return {
      ok: true,
      available: !isBusy,
      service: serviceName,
      patient_info: serviceConfig.patientInfo,
      provider: providerName,
      requested_start: formatDateTimeLocal(requestedStart),
      requested_end: formatDateTimeLocal(requestedEnd),
      duration_minutes: durationMinutes,
      timezone: CONFIG.timezone,
      next_available_slots: isBusy
        ? findNextAvailableSlotsForService(requestedStart, serviceName, appointments)
        : []
    };
  }

  const [year, month, day] = payload.date.split("-").map(Number);
  const requestedDate = makeDateInTimeZone({
    year,
    month,
    day,
    hour: 0,
    minute: 0,
    second: 0
  }, CONFIG.timezone);

  if (Number.isNaN(requestedDate.getTime())) {
    return {
      ok: false,
      error: "Invalid date format. Use YYYY-MM-DD."
    };
  }

  if (isDateInPastForClinicDay(requestedDate)) {
    const now = new Date();
    const appointments = filterExcludedAppointments(
      await getStoredAppointments({ anchorDate: now, providerName }),
      excludedAppointmentIds
    );

    return {
      ok: true,
      available: false,
      reason: "Requested date is in the past.",
      service: serviceName,
      patient_info: serviceConfig.patientInfo,
      provider: providerName,
      date: payload.date,
      duration_minutes: durationMinutes,
      timezone: CONFIG.timezone,
      business_hours: null,
      service_time_windows: getServiceTimeWindowsDescription(serviceConfig),
      available_slots: [],
      next_available_slots: findNextAvailableSlotsForService(now, serviceName, appointments)
    };
  }

  const appointments = filterExcludedAppointments(
    await getStoredAppointments({ anchorDate: requestedDate, providerName }),
    excludedAppointmentIds
  );
  const availableSlots = generateSlotsForService(requestedDate, serviceName, appointments);
  const businessHours = getBusinessHoursForDate(requestedDate);

  return {
    ok: true,
    available: availableSlots.length > 0,
    service: serviceName,
    patient_info: serviceConfig.patientInfo,
    provider: providerName,
    date: payload.date,
    duration_minutes: durationMinutes,
    timezone: CONFIG.timezone,
    business_hours: businessHours
      ? { start: businessHours[0], end: businessHours[1] }
      : null,
    service_time_windows: getServiceTimeWindowsDescription(serviceConfig),
    available_slots: availableSlots,
    next_available_slots: availableSlots.length > 0
      ? []
      : findNextAvailableSlotsForService(requestedDate, serviceName, appointments)
  };
}

async function bookAppointment(payload) {
  if (!payload.start_time) {
    return {
      ok: false,
      error: "Missing required field: start_time"
    };
  }

  const serviceName = payload.service;
  const serviceValidation = validateService(serviceName);

  if (!serviceValidation.ok) {
    return serviceValidation;
  }

  const providerName = CONFIG.calendarProvider;
  const provider = getCalendarProvider(providerName);
  const serviceConfig = getServiceConfig(serviceName);
  const availabilityResult = await checkAvailability({
    start_time: payload.start_time,
    service: serviceName,
    provider_name: providerName
  });

  if (!availabilityResult.ok) {
    return availabilityResult;
  }

  if (!availabilityResult.available) {
    return {
      ok: false,
      error: "Requested slot is not available.",
      service: serviceName,
      requested_start: availabilityResult.requested_start,
      next_available_slots: availabilityResult.next_available_slots
    };
  }

  // Final availability re-check to prevent race condition (check->create gap)
  const finalCheckResult = await checkAvailability({
    start_time: payload.start_time,
    service: serviceName,
    provider_name: providerName
  });

  if (!finalCheckResult.ok || !finalCheckResult.available) {
    return {
      ok: false,
      error: "Requested slot was just booked by another request. Please check availability and try again.",
      service: serviceName,
      requested_start: availabilityResult.requested_start,
      next_available_slots: finalCheckResult.next_available_slots || availabilityResult.next_available_slots
    };
  }

  const appointment = {
    id: createAppointmentId(),
    customer_name: payload.customer_name || null,
    customer_phone: payload.customer_phone || null,
    customer_email: payload.customer_email || null,
    service: serviceName,
    start_time: availabilityResult.requested_start,
    end_time: availabilityResult.requested_end,
    notes: payload.notes || null,
    status: "confirmed",
    created_at: new Date().toISOString()
  };

  const manageCodeData = createManageCode();
  const storedAppointment = await provider.createAppointment(appointment);
  const storedAppointmentWithProviderId = {
    ...storedAppointment,
    provider_appointment_id: getProviderAppointmentId(storedAppointment)
  };

  try {
    createAppointmentRegistryEntry(
      createRegistryEntry({
        appointment: storedAppointmentWithProviderId,
        providerName,
        manageCodeHmac: manageCodeData.manageCodeHmac,
        status: "confirmed"
      })
    );
  } catch (error) {
    await rollbackCreatedAppointment(providerName, storedAppointmentWithProviderId);
    throw error;
  }

  const manageCodeDelivery = await persistManageCodeDelivery({
    appointmentId: storedAppointmentWithProviderId.id,
    manageCode: manageCodeData.manageCode,
    appointment: storedAppointmentWithProviderId
  });

  return {
    ok: true,
    booked: true,
    service: serviceName,
    patient_info: serviceConfig.patientInfo,
    provider: providerName,
    appointment: storedAppointmentWithProviderId,
    manage_code: manageCodeData.manageCode,
    manage_code_delivery: manageCodeDelivery
  };
}

async function lookupBookingByManageCode(payload) {
  const lookupResult = getManageableAppointmentFromPayload(payload);

  if (!lookupResult.ok) {
    return lookupResult;
  }

  const appointment = lookupResult.record;

  return {
    ok: true,
    manageable: true,
    provider: appointment.provider,
    appointment_summary: buildAppointmentSummary(appointment),
    service: appointment.service,
    start_time: appointment.start_time,
    end_time: appointment.end_time,
    timezone: CONFIG.timezone,
    appointment_status: appointment.status,
    allowed_actions: ["cancel", "reschedule"]
  };
}

async function cancelAppointment(payload) {
  const lookupResult = getManageableAppointmentFromPayload(payload);

  if (!lookupResult.ok) {
    return lookupResult;
  }

  const appointment = lookupResult.record;
  const provider = getCalendarProvider(appointment.provider);
  let cancelled = false;

  try {
    cancelled = await provider.cancelAppointment({
      appointmentId: appointment.provider_appointment_id
    });
  } catch (error) {
    return {
      ok: false,
      error: "Unable to cancel the booking at the moment. Please try again later."
    };
  }

  if (!cancelled) {
    return {
      ok: false,
      error: "Unable to cancel the booking at the moment. Please try again later."
    };
  }

  const registryUpdated = markAppointmentRegistryCancelled({
    appointmentId: appointment.appointment_id,
    updatedAt: new Date().toISOString()
  });

  if (!registryUpdated) {
    const refreshedRegistryRecord = getAppointmentRegistryById(appointment.appointment_id);

    if (refreshedRegistryRecord && refreshedRegistryRecord.status === "cancelled") {
      return {
        ok: true,
        cancelled: true,
        provider: appointment.provider,
        service: appointment.service,
        start_time: appointment.start_time,
        appointment_status: "cancelled"
      };
    }

    throw new Error("Cancellation succeeded in provider but registry synchronization failed.");
  }

  return {
    ok: true,
    cancelled: true,
    provider: appointment.provider,
    service: appointment.service,
    start_time: appointment.start_time,
    appointment_status: "cancelled"
  };
}

async function rescheduleAppointment(payload) {
  if (!payload.new_start_time) {
    return {
      ok: false,
      error: "Missing required field: new_start_time"
    };
  }

  const newStartTimeValidation = validateStartTimeInput(payload.new_start_time, "new_start_time");
  if (!newStartTimeValidation.ok) {
    return newStartTimeValidation;
  }

  const lookupResult = getManageableAppointmentFromPayload(payload);

  if (!lookupResult.ok) {
    return lookupResult;
  }

  const appointment = lookupResult.record;

  if (isSameInstant(payload.new_start_time, appointment.start_time)) {
    return {
      ok: false,
      error: "The new_start_time must be different from the current appointment time."
    };
  }

  const availabilityResult = await checkAvailability({
    start_time: payload.new_start_time,
    service: appointment.service,
    provider_name: appointment.provider,
    exclude_appointment_ids: [
      appointment.appointment_id,
      appointment.provider_appointment_id
    ]
  });

  if (!availabilityResult.ok) {
    return availabilityResult;
  }

  if (!availabilityResult.available) {
    return {
      ok: false,
      error: "Requested slot is not available.",
      service: appointment.service,
      requested_start: availabilityResult.requested_start,
      next_available_slots: availabilityResult.next_available_slots
    };
  }

  const provider = getCalendarProvider(appointment.provider);
  const newAppointment = {
    id: createAppointmentId(),
    customer_name: appointment.customer_name || null,
    customer_phone: appointment.customer_phone || null,
    customer_email: appointment.customer_email || null,
    service: appointment.service,
    start_time: availabilityResult.requested_start,
    end_time: availabilityResult.requested_end,
    notes: appointment.notes || null,
    status: "confirmed",
    created_at: new Date().toISOString()
  };

  const newManageCodeData = createManageCode();
  const storedNewAppointment = await provider.createAppointment(newAppointment);
  const storedNewAppointmentWithProviderId = {
    ...storedNewAppointment,
    provider_appointment_id: getProviderAppointmentId(storedNewAppointment)
  };

  try {
    createAppointmentRegistryEntry(
      createRegistryEntry({
        appointment: storedNewAppointmentWithProviderId,
        providerName: appointment.provider,
        manageCodeHmac: newManageCodeData.manageCodeHmac,
        status: "pending_reschedule"
      })
    );
  } catch (error) {
    await rollbackCreatedAppointment(appointment.provider, storedNewAppointmentWithProviderId);
    throw error;
  }

  let oldCancelled = false;

  try {
    oldCancelled = await provider.cancelAppointment({
      appointmentId: appointment.provider_appointment_id
    });
  } catch (error) {
    oldCancelled = false;
  }

  if (!oldCancelled) {
    const rollbackSucceeded = await rollbackCreatedAppointment(
      appointment.provider,
      storedNewAppointmentWithProviderId
    );

    if (rollbackSucceeded) {
      deleteAppointmentRegistryEntry(storedNewAppointmentWithProviderId.id);
    } else {
      markAppointmentRegistryRollbackFailed({
        appointmentId: storedNewAppointmentWithProviderId.id,
        updatedAt: new Date().toISOString(),
        errorMessage: "Failed to cancel the original appointment and failed to roll back the new appointment."
      });
    }

    return {
      ok: false,
      error: "Unable to reschedule the booking at the moment. Please try again later."
    };
  }

  try {
    finalizeRescheduleTransition({
      oldAppointmentId: appointment.appointment_id,
      newAppointmentId: storedNewAppointmentWithProviderId.id,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    const rollbackSucceeded = await rollbackCreatedAppointment(
      appointment.provider,
      storedNewAppointmentWithProviderId
    );

    if (rollbackSucceeded) {
      deleteAppointmentRegistryEntry(storedNewAppointmentWithProviderId.id);
    } else {
      markAppointmentRegistryRollbackFailed({
        appointmentId: storedNewAppointmentWithProviderId.id,
        updatedAt: new Date().toISOString(),
        errorMessage: "Reschedule transition failed and rollback could not cancel the new appointment."
      });
    }

    return {
      ok: false,
      error: "Unable to reschedule the booking at the moment. Please try again later."
    };
  }

  const manageCodeDelivery = await persistManageCodeDelivery({
    appointmentId: storedNewAppointmentWithProviderId.id,
    manageCode: newManageCodeData.manageCode,
    appointment: storedNewAppointmentWithProviderId
  });

  return {
    ok: true,
    rescheduled: true,
    provider: appointment.provider,
    service: appointment.service,
    old_start_time: appointment.start_time,
    new_appointment: storedNewAppointmentWithProviderId,
    new_manage_code: newManageCodeData.manageCode,
    manage_code_delivery: manageCodeDelivery
  };
}

module.exports = {
  bookAppointment,
  cancelAppointment,
  checkAvailability,
  findNextAvailableSlots,
  findNextAvailableSlotsForService,
  formatDateTimeLocal,
  generateSlotsForDate,
  generateSlotsForService,
  getStoredAppointments,
  lookupBookingByManageCode,
  rescheduleAppointment
};
