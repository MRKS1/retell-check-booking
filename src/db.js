const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "data");
const DATABASE_PATH = process.env.APPOINTMENTS_DB_PATH || path.join(DATA_DIR, "appointments.db");
const SEED_PATH = path.join(DATA_DIR, "bookings.json");

let database;

function getDatabase() {
  if (!database) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    database = new DatabaseSync(DATABASE_PATH);
  }

  return database;
}

function initializeDatabase() {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      customer_name TEXT,
      customer_phone TEXT,
      customer_email TEXT,
      service TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TEXT NOT NULL
    );
  `);

  seedAppointments(db);
}

function seedAppointments(db) {
  const countRow = db.prepare("SELECT COUNT(*) AS count FROM appointments").get();

  if (countRow.count > 0 || !fs.existsSync(SEED_PATH)) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO appointments (
      id,
      customer_name,
      customer_phone,
      customer_email,
      service,
      start_time,
      end_time,
      notes,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedRows = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));

  for (const row of seedRows) {
    insert.run(
      row.id,
      row.customer_name || null,
      row.customer_phone || null,
      row.customer_email || null,
      row.service || "general_consultation",
      row.start,
      row.end,
      row.notes || "Seeded appointment",
      "confirmed",
      new Date().toISOString()
    );
  }
}

function listAppointments() {
  return listAppointmentsInRange({});
}

function listAppointmentsInRange({ startDate, endDate }) {
  let query = `
      SELECT
        id,
        customer_name,
        customer_phone,
        customer_email,
        service,
        start_time,
        end_time,
        notes,
        status,
        created_at
      FROM appointments
      WHERE status = 'confirmed'
  `;
  const params = [];

  if (startDate) {
    query += " AND end_time > ?";
    params.push(startDate);
  }

  if (endDate) {
    query += " AND start_time < ?";
    params.push(endDate);
  }

  query += " ORDER BY start_time ASC";

  return getDatabase()
    .prepare(query)
    .all(...params);
}

function createAppointment(appointment) {
  getDatabase()
    .prepare(`
      INSERT INTO appointments (
        id,
        customer_name,
        customer_phone,
        customer_email,
        service,
        start_time,
        end_time,
        notes,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      appointment.id,
      appointment.customer_name,
      appointment.customer_phone,
      appointment.customer_email,
      appointment.service,
      appointment.start_time,
      appointment.end_time,
      appointment.notes,
      appointment.status,
      appointment.created_at
    );
}

function cancelAppointmentById(appointmentId) {
  const info = getDatabase()
    .prepare(`
      UPDATE appointments
      SET status = 'cancelled'
      WHERE id = ?
        AND status = 'confirmed'
    `)
    .run(appointmentId);

  return info.changes > 0;
}

function resetDatabase() {
  const db = getDatabase();
  db.exec("DELETE FROM appointments;");
}

module.exports = {
  DATABASE_PATH,
  cancelAppointmentById,
  createAppointment,
  initializeDatabase,
  listAppointments,
  listAppointmentsInRange,
  resetDatabase
};
