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

function generateSlotsForDate(date, durationMinutes, appointments) {
  const businessHours = getBusinessHoursForDate(date);

  if (!businessHours) {
    return [];
  }

  const [startTime, endTime] = businessHours;
  const startMinutes = parseMinutes(startTime);
  const endMinutes = parseMinutes(endTime);
  const slots = [];
  const appointmentsForDay = getAppointmentsForDay(appointments, date);

  for (
    let currentMinutes = startMinutes;
    currentMinutes + durationMinutes <= endMinutes;
    currentMinutes += CONFIG.slotIntervalMinutes
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

function getValidatedDurationMinutes(payload) {
  const durationMinutes = Number(payload.duration_minutes) || CONFIG.defaultDurationMinutes;

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return {
      ok: false,
      error: "duration_minutes must be a positive integer."
    };
  }

  return {
    ok: true,
    durationMinutes
  };
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
  const durationResult = getValidatedDurationMinutes(payload);

  if (!durationResult.ok) {
    return durationResult;
  }

  if (!payload.date && !payload.start_time) {
    return {
      ok: false,
      error: "Missing required field: date or start_time"
    };
  }

  const { durationMinutes } = durationResult;

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
        provider: CONFIG.calendarProvider,
        requested_start: formatDateTimeLocal(requestedStart),
        next_available_slots: findNextAvailableSlots(requestedStart, durationMinutes, appointments)
      };
    }

    const [startTime, endTime] = businessHours;
    const dayStart = setTimeForDate(requestedStart, startTime);
    const dayEnd = setTimeForDate(requestedStart, endTime);
    const insideBusinessHours = requestedStart >= dayStart && requestedEnd <= dayEnd;

    if (!insideBusinessHours) {
      return {
        ok: true,
        available: false,
        reason: "Outside business hours",
        provider: CONFIG.calendarProvider,
        requested_start: formatDateTimeLocal(requestedStart),
        business_hours: {
          start: startTime,
          end: endTime
        },
        next_available_slots: findNextAvailableSlots(requestedStart, durationMinutes, appointments)
      };
    }

    const appointmentsForDay = getAppointmentsForDay(appointments, requestedStart);
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
      provider: CONFIG.calendarProvider,
      requested_start: formatDateTimeLocal(requestedStart),
      requested_end: formatDateTimeLocal(requestedEnd),
      duration_minutes: durationMinutes,
      timezone: CONFIG.timezone,
      next_available_slots: isBusy
        ? findNextAvailableSlots(requestedStart, durationMinutes, appointments)
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
  const availableSlots = generateSlotsForDate(requestedDate, durationMinutes, appointments);
  const businessHours = getBusinessHoursForDate(requestedDate);

  return {
    ok: true,
    available: availableSlots.length > 0,
    provider: CONFIG.calendarProvider,
    date: payload.date,
    duration_minutes: durationMinutes,
    timezone: CONFIG.timezone,
    business_hours: businessHours
      ? { start: businessHours[0], end: businessHours[1] }
      : null,
    available_slots: availableSlots,
    next_available_slots: availableSlots.length > 0
      ? availableSlots.slice(0, CONFIG.maxSuggestions)
      : findNextAvailableSlots(requestedDate, durationMinutes, appointments)
  };
}

async function bookAppointment(payload) {
  if (!payload.start_time) {
    return {
      ok: false,
      error: "Missing required field: start_time"
    };
  }

  const provider = getCalendarProvider();
  const durationResult = getValidatedDurationMinutes(payload);

  if (!durationResult.ok) {
    return durationResult;
  }

  const availabilityResult = await checkAvailability({
    start_time: payload.start_time,
    duration_minutes: durationResult.durationMinutes
  });

  if (!availabilityResult.ok) {
    return availabilityResult;
  }

  if (!availabilityResult.available) {
    return {
      ok: false,
      error: "Requested slot is not available.",
      requested_start: availabilityResult.requested_start,
      next_available_slots: availabilityResult.next_available_slots
    };
  }

  const appointment = {
    id: createAppointmentId(),
    customer_name: payload.customer_name || null,
    customer_phone: payload.customer_phone || null,
    customer_email: payload.customer_email || null,
    service: payload.service || "general_consultation",
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
  formatDateTimeLocal,
  generateSlotsForDate,
  getStoredAppointments
};
