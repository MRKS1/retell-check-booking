const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.CALENDAR_PROVIDER = process.env.CALENDAR_PROVIDER || "sqlite";
process.env.APPOINTMENTS_DB_PATH = process.env.APPOINTMENTS_DB_PATH || path.join(__dirname, "test-appointments.db");
process.env.MANAGE_CODE_SECRET = process.env.MANAGE_CODE_SECRET || "test-manage-code-secret";
process.env.SMS_PROVIDER = process.env.SMS_PROVIDER || "console";

const { CONFIG } = require("../src/config");
const {
  bookAppointment,
  cancelAppointment,
  checkAvailability,
  getStoredAppointments,
  lookupBookingByManageCode,
  rescheduleAppointment
} = require("../src/availability");
const {
  createAppointment,
  createAppointmentRegistryEntry,
  listAppointmentRegistryEntries,
  resetDatabase
} = require("../src/db");
const { registerCalendarProvider } = require("../src/providers");
const { extractFunctionArgs, formatRetellResponse } = require("../src/retell");
const { registerSmsProvider } = require("../src/sms");
const {
  formatDateOnlyInTimeZone,
  formatDateTimeInTimeZone,
  getTimeZoneParts,
  makeDateInTimeZone
} = require("../src/timezone");

const TZ = "Europe/Bratislava";

function getNextFutureBusinessDay() {
  let cursor = new Date();
  cursor.setDate(cursor.getDate() + 1);

  while (true) {
    const { weekday } = getTimeZoneParts(cursor, TZ);
    if (weekday !== "saturday" && weekday !== "sunday") {
      return cursor;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
}

function makeLocalISO(date, hour, minute = 0) {
  const { year, month, day } = getTimeZoneParts(date, TZ);
  const d = makeDateInTimeZone({ year, month, day, hour, minute, second: 0 }, TZ);
  return formatDateTimeInTimeZone(d, TZ);
}

function makeDateOnly(date) {
  return formatDateOnlyInTimeZone(date, TZ);
}

registerSmsProvider("failing", {
  name: "failing",
  async sendSms() {
    throw new Error("Simulated SMS failure");
  }
});

const fakeGoogleState = new Map();

registerCalendarProvider("fake_google", {
  name: "fake_google",

  initialize() {
    return null;
  },

  async listAppointments({ startDate, endDate }) {
    return Array.from(fakeGoogleState.values())
      .filter((appointment) => appointment.status === "confirmed")
      .filter((appointment) => {
        const appointmentStart = new Date(appointment.start_time);
        const appointmentEnd = new Date(appointment.end_time);
        if (startDate && appointmentEnd <= startDate) {
          return false;
        }
        if (endDate && appointmentStart >= endDate) {
          return false;
        }
        return true;
      });
  },

  async createAppointment(appointment) {
    const providerAppointmentId = `gcal_${fakeGoogleState.size + 1}`;
    const stored = {
      ...appointment,
      provider_appointment_id: providerAppointmentId,
      created_at: appointment.created_at
    };
    fakeGoogleState.set(providerAppointmentId, {
      ...stored,
      status: "confirmed"
    });
    return stored;
  },

  async cancelAppointment({ appointmentId }) {
    const existing = fakeGoogleState.get(appointmentId);

    if (!existing || existing.status !== "confirmed") {
      return false;
    }

    existing.status = "cancelled";
    return true;
  }
});

test.beforeEach(() => {
  resetDatabase();
  fakeGoogleState.clear();
  CONFIG.calendarProvider = "sqlite";
  CONFIG.smsProvider = "console";
});

test("returns available slots for vstupne_vysetrenie on a working day", async () => {
  const day = getNextFutureBusinessDay();
  const dateStr = makeDateOnly(day);

  const result = await checkAvailability({
    date: dateStr,
    service: "vstupne_vysetrenie"
  });

  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.ok(Array.isArray(result.available_slots));
  assert.ok(result.available_slots.length > 0);
  assert.ok(result.available_slots[0].start.startsWith(dateStr + "T09:00:00"));
  assert.equal(result.available_slots[0].order_number, 1);
  assert.equal(result.service, "vstupne_vysetrenie");
  assert.ok(result.patient_info);
});

test("returns available slots for sportova_prehliadka", async () => {
  const day = getNextFutureBusinessDay();
  const dateStr = makeDateOnly(day);

  const result = await checkAvailability({
    date: dateStr,
    service: "sportova_prehliadka"
  });

  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.available_slots.length, 5);
  assert.ok(result.available_slots[0].start.startsWith(dateStr + "T07:00:00"));
  assert.ok(result.available_slots[4].start.startsWith(dateStr + "T08:20:00"));
  assert.equal(result.available_slots[4].order_number, 5);
  assert.equal(result.duration_minutes, 20);
});

test("returns only 2 slots for konzultacia", async () => {
  const day = getNextFutureBusinessDay();
  const dateStr = makeDateOnly(day);

  const result = await checkAvailability({
    date: dateStr,
    service: "konzultacia"
  });

  assert.equal(result.ok, true);
  assert.equal(result.available_slots.length, 2);
  assert.ok(result.available_slots[0].start.startsWith(dateStr + "T14:40:00"));
  assert.ok(result.available_slots[1].start.startsWith(dateStr + "T14:50:00"));
});

test("marks an occupied slot as unavailable", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);

  await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Existing Customer"
  });

  const result = await checkAvailability({
    start_time: startTime,
    service: "vstupne_vysetrenie"
  });

  assert.equal(result.ok, true);
  assert.equal(result.available, false);
  assert.ok(result.next_available_slots.length > 0);
});

test("books a free slot and stores only the manage code hash", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 10, 0);

  const result = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe",
    customer_phone: "+421900000000"
  });

  assert.equal(result.ok, true);
  assert.equal(result.booked, true);
  assert.equal(result.appointment.customer_name, "Jane Doe");
  assert.equal(result.service, "vstupne_vysetrenie");
  assert.match(result.manage_code, /^\d{8}$/);
  assert.equal(result.manage_code_delivery.mode, "sms_and_voice");
  assert.equal(result.manage_code_delivery.sms_status, "sent");
  assert.ok(result.patient_info);

  const appointments = await getStoredAppointments({ anchorDate: day });
  assert.equal(appointments.length, 1);
  assert.equal(appointments[0].customer_name, "Jane Doe");

  const registryEntries = listAppointmentRegistryEntries();
  assert.equal(registryEntries.length, 1);
  assert.equal(registryEntries[0].appointment_id, result.appointment.id);
  assert.equal(registryEntries[0].status, "confirmed");
  assert.equal(registryEntries[0].sms_delivery_status, "sent");
  assert.ok(registryEntries[0].manage_code_hmac);
  assert.equal(Object.prototype.hasOwnProperty.call(registryEntries[0], "manage_code"), false);
});

test("refuses to book an occupied slot", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 10, 0);

  await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe"
  });

  const result = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "John Doe"
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /not available/i);
});

test("rejects booking outside service time window", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 12, 0);

  const result = await checkAvailability({
    start_time: startTime,
    service: "vstupne_vysetrenie"
  });

  assert.equal(result.ok, true);
  assert.equal(result.available, false);
  assert.match(result.reason, /Outside time window/i);
});

test("rejects start_time without timezone offset", async () => {
  const result = await checkAvailability({
    start_time: "2030-04-15T09:00:00",
    service: "vstupne_vysetrenie"
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /timezone offset is required/i);
});

test("marks a past start_time as unavailable", async () => {
  const result = await checkAvailability({
    start_time: "2024-04-10T09:00:00+02:00",
    service: "vstupne_vysetrenie"
  });

  assert.equal(result.ok, true);
  assert.equal(result.available, false);
  assert.match(result.reason, /in the past/i);
});

test("refuses booking for a past start_time", async () => {
  const result = await bookAppointment({
    start_time: "2024-04-10T09:00:00+02:00",
    service: "vstupne_vysetrenie",
    customer_name: "Past Booking"
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /not available/i);
});

test("zdravotnicka_pomocka allows max 1 per day", async () => {
  const day = getNextFutureBusinessDay();
  const firstTime = makeLocalISO(day, 9, 0);
  const secondTime = makeLocalISO(day, 9, 10);

  await bookAppointment({
    start_time: firstTime,
    service: "zdravotnicka_pomocka",
    customer_name: "First Patient"
  });

  const result = await checkAvailability({
    start_time: secondTime,
    service: "zdravotnicka_pomocka"
  });

  assert.equal(result.ok, true);
  assert.equal(result.available, false);
  assert.match(result.reason, /Maximum 1/i);
});

test("looks up an existing booking by manage code", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);
  const booking = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe"
  });

  const result = await lookupBookingByManageCode({
    manage_code: booking.manage_code
  });

  assert.equal(result.ok, true);
  assert.equal(result.manageable, true);
  assert.equal(result.start_time, booking.appointment.start_time);
  assert.deepEqual(result.allowed_actions, ["cancel", "reschedule"]);
});

test("returns a generic error for invalid manage code lookup", async () => {
  const result = await lookupBookingByManageCode({
    manage_code: "99999999"
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /No active booking/i);
});

test("cancels an existing appointment by manage code", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);

  const booking = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe"
  });

  const result = await cancelAppointment({
    manage_code: booking.manage_code
  });

  assert.equal(result.ok, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.appointment_status, "cancelled");

  const secondAttempt = await cancelAppointment({
    manage_code: booking.manage_code
  });
  assert.equal(secondAttempt.ok, false);

  const registryEntries = listAppointmentRegistryEntries();
  assert.equal(registryEntries[0].status, "cancelled");
  assert.equal(registryEntries[0].manage_code_hmac, null);
});

test("reschedules an appointment and invalidates the old manage code", async () => {
  const day = getNextFutureBusinessDay();
  const oldStartTime = makeLocalISO(day, 9, 0);
  const newStartTime = makeLocalISO(day, 9, 20);

  const booking = await bookAppointment({
    start_time: oldStartTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe",
    customer_phone: "+421900000000"
  });

  const result = await rescheduleAppointment({
    manage_code: booking.manage_code,
    new_start_time: newStartTime
  });

  assert.equal(result.ok, true);
  assert.equal(result.rescheduled, true);
  assert.equal(result.old_start_time, oldStartTime);
  assert.equal(result.new_appointment.start_time, newStartTime);
  assert.match(result.new_manage_code, /^\d{8}$/);
  assert.notEqual(result.new_manage_code, booking.manage_code);
  assert.equal(result.manage_code_delivery.sms_status, "sent");

  const oldLookup = await lookupBookingByManageCode({
    manage_code: booking.manage_code
  });
  assert.equal(oldLookup.ok, false);

  const newLookup = await lookupBookingByManageCode({
    manage_code: result.new_manage_code
  });
  assert.equal(newLookup.ok, true);
  assert.equal(newLookup.start_time, newStartTime);

  const registryEntries = listAppointmentRegistryEntries();
  assert.equal(registryEntries.length, 2);
  assert.equal(registryEntries[0].status, "rescheduled");
  assert.equal(registryEntries[0].replaced_by_appointment_id, result.new_appointment.id);
  assert.equal(registryEntries[1].status, "confirmed");
});

test("does not reschedule when the new slot is occupied", async () => {
  const day = getNextFutureBusinessDay();
  const firstStartTime = makeLocalISO(day, 9, 0);
  const occupiedStartTime = makeLocalISO(day, 9, 10);

  const booking = await bookAppointment({
    start_time: firstStartTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe"
  });

  await bookAppointment({
    start_time: occupiedStartTime,
    service: "vstupne_vysetrenie",
    customer_name: "John Doe"
  });

  const result = await rescheduleAppointment({
    manage_code: booking.manage_code,
    new_start_time: occupiedStartTime
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /not available/i);

  const registryEntries = listAppointmentRegistryEntries();
  assert.equal(registryEntries.length, 2);
  assert.equal(registryEntries[0].status, "confirmed");
});

test("refuses to reschedule without new_start_time", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);

  const booking = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe"
  });

  const result = await rescheduleAppointment({
    manage_code: booking.manage_code
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Missing required field: new_start_time/i);
});

test("refuses to reschedule to the same start_time", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);

  const booking = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe"
  });

  const result = await rescheduleAppointment({
    manage_code: booking.manage_code,
    new_start_time: booking.appointment.start_time
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /must be different/i);
});

test("refuses to reschedule to a past start_time", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);

  const booking = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe"
  });

  const result = await rescheduleAppointment({
    manage_code: booking.manage_code,
    new_start_time: "2024-04-10T09:00:00+02:00"
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /not available/i);
});

test("marks SMS failure as voice_only on reschedule but keeps appointment active", async () => {
  CONFIG.smsProvider = "failing";
  const day = getNextFutureBusinessDay();
  const oldStartTime = makeLocalISO(day, 9, 0);
  const newStartTime = makeLocalISO(day, 9, 20);

  const booking = await bookAppointment({
    start_time: oldStartTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe",
    customer_phone: "+421900000000"
  });

  const result = await rescheduleAppointment({
    manage_code: booking.manage_code,
    new_start_time: newStartTime
  });

  assert.equal(result.ok, true);
  assert.equal(result.rescheduled, true);
  assert.equal(result.manage_code_delivery.mode, "voice_only");
  assert.equal(result.manage_code_delivery.sms_status, "failed");

  const registryEntries = listAppointmentRegistryEntries();
  const newEntry = registryEntries.find((entry) => entry.appointment_id === result.new_appointment.id);
  assert.ok(newEntry);
  assert.equal(newEntry.status, "confirmed");
  assert.equal(newEntry.sms_delivery_status, "failed");
  assert.match(newEntry.sms_last_error, /Simulated SMS failure/);
});

test("supports chained reschedule with rotating manage codes", async () => {
  const day = getNextFutureBusinessDay();
  const firstStartTime = makeLocalISO(day, 9, 0);
  const secondStartTime = makeLocalISO(day, 9, 20);
  const thirdStartTime = makeLocalISO(day, 9, 40);

  const booking = await bookAppointment({
    start_time: firstStartTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe",
    customer_phone: "+421900000000"
  });

  const firstReschedule = await rescheduleAppointment({
    manage_code: booking.manage_code,
    new_start_time: secondStartTime
  });

  assert.equal(firstReschedule.ok, true);

  const secondReschedule = await rescheduleAppointment({
    manage_code: firstReschedule.new_manage_code,
    new_start_time: thirdStartTime
  });

  assert.equal(secondReschedule.ok, true);
  assert.notEqual(secondReschedule.new_manage_code, firstReschedule.new_manage_code);

  const oldLookup = await lookupBookingByManageCode({
    manage_code: booking.manage_code
  });
  assert.equal(oldLookup.ok, false);

  const middleLookup = await lookupBookingByManageCode({
    manage_code: firstReschedule.new_manage_code
  });
  assert.equal(middleLookup.ok, false);

  const latestLookup = await lookupBookingByManageCode({
    manage_code: secondReschedule.new_manage_code
  });
  assert.equal(latestLookup.ok, true);
  assert.equal(latestLookup.start_time, thirdStartTime);
});

test("marks SMS failure as voice_only but keeps the booking active", async () => {
  CONFIG.smsProvider = "failing";
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 10, 0);

  const result = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe",
    customer_phone: "+421900000000"
  });

  assert.equal(result.ok, true);
  assert.equal(result.manage_code_delivery.mode, "voice_only");
  assert.equal(result.manage_code_delivery.sms_status, "failed");

  const registryEntries = listAppointmentRegistryEntries();
  assert.equal(registryEntries[0].status, "confirmed");
  assert.equal(registryEntries[0].sms_delivery_status, "failed");
  assert.match(registryEntries[0].sms_last_error, /Simulated SMS failure/);
});

test("legacy bookings without manage code are not self-manageable", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);
  const endTime = makeLocalISO(day, 9, 10);

  createAppointment({
    id: "legacy_1",
    customer_name: "Legacy Patient",
    customer_phone: "+421900111111",
    customer_email: null,
    service: "vstupne_vysetrenie",
    start_time: startTime,
    end_time: endTime,
    notes: "Legacy booking",
    status: "confirmed",
    created_at: new Date().toISOString()
  });

  createAppointmentRegistryEntry({
    appointment_id: "legacy_1",
    provider: "sqlite",
    provider_appointment_id: "legacy_1",
    customer_name: "Legacy Patient",
    customer_phone: "+421900111111",
    customer_email: null,
    service: "vstupne_vysetrenie",
    start_time: startTime,
    end_time: endTime,
    notes: "Legacy booking",
    status: "confirmed",
    manage_code_hmac: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    replaced_by_appointment_id: null,
    sms_delivery_status: null,
    sms_last_error: null
  });

  const result = await lookupBookingByManageCode({
    manage_code: "11112222"
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /No active booking/i);
});

test("supports manage-code booking flow with a fake google provider", async () => {
  CONFIG.calendarProvider = "fake_google";
  CONFIG.smsProvider = "noop";
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);

  const booking = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Google Patient",
    customer_phone: "+421900222222"
  });

  assert.equal(booking.ok, true);
  assert.equal(booking.provider, "fake_google");
  assert.ok(booking.appointment.provider_appointment_id.startsWith("gcal_"));

  const lookup = await lookupBookingByManageCode({
    manage_code: booking.manage_code
  });
  assert.equal(lookup.ok, true);

  const cancellation = await cancelAppointment({
    manage_code: booking.manage_code
  });
  assert.equal(cancellation.ok, true);

  const fakeGoogleRecords = Array.from(fakeGoogleState.values());
  assert.equal(fakeGoogleRecords[0].status, "cancelled");
});

test("rejects invalid payloads", async () => {
  const result = await checkAvailability({
    service: "vstupne_vysetrenie"
  });
  assert.equal(result.ok, true);
  assert.equal(result.available, false);
  assert.ok(Array.isArray(result.next_available_slots));
  assert.ok(result.next_available_slots.length > 0);
});

test("rejects non-string date values", async () => {
  const result = await checkAvailability({
    service: "vstupne_vysetrenie",
    date: 20260413
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid date format/i);
});

test("rejects non-string start_time values", async () => {
  const result = await checkAvailability({
    service: "vstupne_vysetrenie",
    start_time: 123456
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid start_time format/i);
});

test("rejects equivalent new_start_time with different timezone representation", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);

  const booking = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe"
  });

  const asUtc = new Date(booking.appointment.start_time).toISOString();
  const result = await rescheduleAppointment({
    manage_code: booking.manage_code,
    new_start_time: asUtc
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /must be different/i);
});

test("rejects truly invalid payload without service", async () => {
  const result = await checkAvailability({});
  assert.equal(result.ok, false);
});

test("rejects unknown service", async () => {
  const day = getNextFutureBusinessDay();

  const result = await checkAvailability({
    date: makeDateOnly(day),
    service: "unknown_service"
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown service/i);
});

test("extracts args from Retell wrapped request body", () => {
  const result = extractFunctionArgs({
    name: "check_available_slots",
    args: {
      date: "2026-04-03",
      service: "vstupne_vysetrenie"
    },
    call: {
      call_id: "call_123"
    }
  });

  assert.equal(result.isRetellRequest, true);
  assert.equal(result.functionName, "check_available_slots");
  assert.equal(result.call.call_id, "call_123");
  assert.equal(result.args.date, "2026-04-03");
  assert.equal(result.args.service, "vstupne_vysetrenie");
});

test("formats Retell response with booking summary and manage code", () => {
  const response = formatRetellResponse("book_appointment", {
    ok: true,
    appointment: {
      start_time: "2026-04-03T10:00:00+02:00"
    },
    manage_code: "42816357"
  }, {
    call: {
      call_id: "call_123"
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.function_name, "book_appointment");
  assert.equal(response.call_id, "call_123");
  assert.match(response.summary, /Appointment booked/i);
  assert.match(response.summary, /4 2 8 1 6 3 5 7/);
});

test("rejects lookup during pending_reschedule with retry message", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);
  const newTime = makeLocalISO(day, 10, 0);

  // Book first appointment
  const booking = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Test Patient"
  });

  // Reschedule completes (old manage code becomes invalid)
  const rescheduleResult = await rescheduleAppointment({
    manage_code: booking.manage_code,
    new_start_time: newTime
  });

  assert.equal(rescheduleResult.ok, true);

  // Verify that old manage code no longer works (invalidated after reschedule)
  const lookupResult = await lookupBookingByManageCode({
    manage_code: booking.manage_code
  });
  assert.equal(lookupResult.ok, false);
  assert.match(lookupResult.error, /No active booking/i);
});

test("detects double-booking race condition", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);

  // Register a race-testing provider that simulates slot becoming unavailable
  let createCount = 0;
  registerCalendarProvider("race_test_provider", {
    name: "race_test_provider",
    initialize() {
      return null;
    },
    async listAppointments({ startDate, endDate }) {
      return Array.from(fakeGoogleState.values())
        .filter((appointment) => appointment.status === "confirmed")
        .filter((appointment) => {
          const appointmentStart = new Date(appointment.start_time);
          const appointmentEnd = new Date(appointment.end_time);
          if (startDate && appointmentEnd <= startDate) {
            return false;
          }
          if (endDate && appointmentStart >= endDate) {
            return false;
          }
          return true;
        });
    },
    async createAppointment(appointment) {
      createCount++;
      // Simulate race: slot becomes taken between check and create
      if (createCount === 1) {
        const providerAppointmentId = `race_${createCount}`;
        const stored = {
          ...appointment,
          provider_appointment_id: providerAppointmentId,
          created_at: appointment.created_at
        };
        fakeGoogleState.set(providerAppointmentId, {
          ...stored,
          status: "confirmed"
        });
        // Inject competing appointment that blocks second request
        fakeGoogleState.set("competing_1", {
          id: "competing_1",
          start_time: appointment.start_time,
          end_time: appointment.end_time,
          service: appointment.service,
          status: "confirmed"
        });
        return stored;
      }
      throw new Error("Slot taken");
    },
    async cancelAppointment({ appointmentId }) {
      fakeGoogleState.delete(appointmentId);
      return true;
    }
  });

  const originalProvider = CONFIG.calendarProvider;
  CONFIG.calendarProvider = "race_test_provider";
  createCount = 0;

  try {
    // First booking succeeds
    const booking1 = await bookAppointment({
      start_time: startTime,
      service: "vstupne_vysetrenie",
      customer_name: "Patient 1"
    });
    assert.equal(booking1.ok, true);

    // Second booking should fail due to race detection (final check catches conflict)
    const booking2 = await bookAppointment({
      start_time: startTime,
      service: "vstupne_vysetrenie",
      customer_name: "Patient 2"
    });

    assert.equal(booking2.ok, false);
    assert.match(booking2.error, /just booked|not available/i);
  } finally {
    CONFIG.calendarProvider = originalProvider;
  }
});
