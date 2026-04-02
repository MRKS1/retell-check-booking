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

initializeCalendarProvider();

test.beforeEach(() => {
  resetDatabase();
});

test("returns available slots for a working day", async () => {
  const result = await checkAvailability({
    date: "2026-04-03",
    duration_minutes: 30
  });

  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.ok(Array.isArray(result.available_slots));
  assert.ok(result.available_slots.length > 0);
  assert.equal(result.available_slots[0].start, "2026-04-03T09:00:00+02:00");
});

test("marks an occupied slot as unavailable", async () => {
  await bookAppointment({
    start_time: "2026-04-03T09:30:00+02:00",
    duration_minutes: 30,
    customer_name: "Existing Customer"
  });

  const result = await checkAvailability({
    start_time: "2026-04-03T09:30:00+02:00",
    duration_minutes: 30
  });

  assert.equal(result.ok, true);
  assert.equal(result.available, false);
  assert.ok(result.next_available_slots.length > 0);
});

test("books a free slot and stores the appointment", async () => {
  const result = await bookAppointment({
    start_time: "2026-04-03T10:00:00+02:00",
    duration_minutes: 30,
    customer_name: "Jane Doe",
    customer_phone: "+421900000000",
    service: "intro_call"
  });

  assert.equal(result.ok, true);
  assert.equal(result.booked, true);
  assert.equal(result.appointment.customer_name, "Jane Doe");

  const appointments = await getStoredAppointments();
  assert.equal(appointments.length, 1);
  assert.equal(appointments[0].customer_name, "Jane Doe");
});

test("refuses to book an occupied slot", async () => {
  await bookAppointment({
    start_time: "2026-04-03T10:00:00+02:00",
    duration_minutes: 30,
    customer_name: "Jane Doe"
  });

  const result = await bookAppointment({
    start_time: "2026-04-03T10:00:00+02:00",
    duration_minutes: 30,
    customer_name: "John Doe"
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /not available/i);
});

test("cancels an existing appointment", async () => {
  const booking = await bookAppointment({
    start_time: "2026-04-03T11:00:00+02:00",
    duration_minutes: 30,
    customer_name: "Jane Doe"
  });

  const result = await cancelAppointment({
    appointment_id: booking.appointment.id
  });

  assert.equal(result.ok, true);
  assert.equal(result.cancelled, true);
});

test("rejects invalid payloads", async () => {
  const result = await checkAvailability({});
  assert.equal(result.ok, false);
});

test("extracts args from Retell wrapped request body", () => {
  const result = extractFunctionArgs({
    name: "check_available_slots",
    args: {
      date: "2026-04-03",
      duration_minutes: 30
    },
    call: {
      call_id: "call_123"
    }
  });

  assert.equal(result.isRetellRequest, true);
  assert.equal(result.functionName, "check_available_slots");
  assert.equal(result.call.call_id, "call_123");
  assert.equal(result.args.date, "2026-04-03");
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
