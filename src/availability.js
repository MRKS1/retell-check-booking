const { CONFIG } = require("./config");
const { getCalendarProvider } = require("./providers");
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
    const existingCount = appointmentsForDay.filter((a) => a.service === serviceName).length;
    if (existingCount >= serviceConfig.maxPerDay) return [];
  }

  const allSlots = [];

  for (const [windowStart, windowEnd] of serviceConfig.timeWindows) {
    const windowSlots = generateSlotsForWindow(
      date, windowStart, windowEnd,
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
    date, startTime, endTime,
    durationMinutes, CONFIG.slotIntervalMinutes,
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

async function getStoredAppointments({ anchorDate = new Date() } = {}) {
  const provider = getCalendarProvider();
  const searchWindow = getSearchWindow(anchorDate);

  return provider.listAppointments({
    startDate: searchWindow.startDate,
    endDate: searchWindow.endDate
  });
}

function createAppointmentId() {
  return `appt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function checkAvailability(payload) {
  const serviceName = payload.service;
  const serviceValidation = validateService(serviceName);

  if (!serviceValidation.ok) {
    return serviceValidation;
  }

  const serviceConfig = getServiceConfig(serviceName);
  const durationMinutes = serviceConfig.durationMinutes;

  if (!payload.date && !payload.start_time) {
    return {
      ok: false,
      error: "Missing required field: date or start_time"
    };
  }

  if (payload.start_time) {
    const requestedStart = new Date(payload.start_time);

    if (Number.isNaN(requestedStart.getTime())) {
      return {
        ok: false,
        error: "Invalid start_time format. Use ISO 8601."
      };
    }

    const appointments = await getStoredAppointments({ anchorDate: requestedStart });
    const requestedEnd = new Date(requestedStart.getTime() + (durationMinutes * 60 * 1000));
    const businessHours = getBusinessHoursForDate(requestedStart);

    if (!businessHours) {
      return {
        ok: true,
        available: false,
        reason: "Outside business days",
        service: serviceName,
        patient_info: serviceConfig.patientInfo,
        provider: CONFIG.calendarProvider,
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
        provider: CONFIG.calendarProvider,
        requested_start: formatDateTimeLocal(requestedStart),
        service_time_windows: getServiceTimeWindowsDescription(serviceConfig),
        next_available_slots: findNextAvailableSlotsForService(requestedStart, serviceName, appointments)
      };
    }

    const appointmentsForDay = getAppointmentsForDay(appointments, requestedStart);

    if (serviceConfig.maxPerDay !== null) {
      const serviceCount = appointmentsForDay.filter((a) => a.service === serviceName).length;
      if (serviceCount >= serviceConfig.maxPerDay) {
        return {
          ok: true,
          available: false,
          reason: `Maximum ${serviceConfig.maxPerDay} ${serviceConfig.label} per day already booked.`,
          service: serviceName,
          patient_info: serviceConfig.patientInfo,
          provider: CONFIG.calendarProvider,
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
      provider: CONFIG.calendarProvider,
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

  const appointments = await getStoredAppointments({ anchorDate: requestedDate });
  const availableSlots = generateSlotsForService(requestedDate, serviceName, appointments);
  const businessHours = getBusinessHoursForDate(requestedDate);

  return {
    ok: true,
    available: availableSlots.length > 0,
    service: serviceName,
    patient_info: serviceConfig.patientInfo,
    provider: CONFIG.calendarProvider,
    date: payload.date,
    duration_minutes: durationMinutes,
    timezone: CONFIG.timezone,
    business_hours: businessHours
      ? { start: businessHours[0], end: businessHours[1] }
      : null,
    service_time_windows: getServiceTimeWindowsDescription(serviceConfig),
    available_slots: availableSlots,
    next_available_slots: availableSlots.length > 0
      ? availableSlots.slice(0, CONFIG.maxSuggestions)
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

  const serviceConfig = getServiceConfig(serviceName);
  const provider = getCalendarProvider();

  const availabilityResult = await checkAvailability({
    start_time: payload.start_time,
    service: serviceName
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

  const storedAppointment = await provider.createAppointment(appointment);

  return {
    ok: true,
    booked: true,
    service: serviceName,
    patient_info: serviceConfig.patientInfo,
    provider: CONFIG.calendarProvider,
    appointment: storedAppointment
  };
}

async function cancelAppointment(payload) {
  const provider = getCalendarProvider();
  const appointmentId = payload.appointment_id || payload.id;

  if (!appointmentId) {
    return {
      ok: false,
      error: "Missing required field: appointment_id"
    };
  }

  const cancelled = await provider.cancelAppointment({
    appointmentId
  });

  if (!cancelled) {
    return {
      ok: false,
      error: "Appointment not found or already cancelled.",
      appointment_id: appointmentId
    };
  }

  return {
    ok: true,
    cancelled: true,
    provider: CONFIG.calendarProvider,
    appointment_id: appointmentId
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
  getStoredAppointments
};
