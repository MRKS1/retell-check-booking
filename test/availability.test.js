const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.CALENDAR_PROVIDER = process.env.CALENDAR_PROVIDER || "sqlite";
process.env.APPOINTMENTS_DB_PATH = process.env.APPOINTMENTS_DB_PATH || path.join(__dirname, "test-appointments.db");

const {
  bookAppointment,
  cancelAppointment,
  checkAvailability,
  getStoredAppointments
} = require("../src/availability");
const { initializeCalendarProvider } = require("../src/providers");
const { resetDatabase } = require("../src/db");
const { extractFunctionArgs, formatRetellResponse } = require("../src/retell");
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

initializeCalendarProvider();

test.beforeEach(() => {
  resetDatabase();
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

test("books a free vstupne_vysetrenie slot", async () => {
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
  assert.ok(result.patient_info);

  const appointments = await getStoredAppointments({ anchorDate: day });
  assert.equal(appointments.length, 1);
  assert.equal(appointments[0].customer_name, "Jane Doe");
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

test("cancels an existing appointment", async () => {
  const day = getNextFutureBusinessDay();
  const startTime = makeLocalISO(day, 9, 0);

  const booking = await bookAppointment({
    start_time: startTime,
    service: "vstupne_vysetrenie",
    customer_name: "Jane Doe"
  });

  const result = await cancelAppointment({
    appointment_id: booking.appointment.id
  });

  assert.equal(result.ok, true);
  assert.equal(result.cancelled, true);
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

test("formats Retell response with a summary", () => {
  const response = formatRetellResponse("book_appointment", {
    ok: true,
    appointment: {
      start_time: "2026-04-03T10:00:00+02:00"
    }
  }, {
    call: {
      call_id: "call_123"
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.function_name, "book_appointment");
  assert.equal(response.call_id, "call_123");
  assert.match(response.summary, /Appointment booked/i);
});
