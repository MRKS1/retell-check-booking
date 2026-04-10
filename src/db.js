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

  db.exec(`
    CREATE TABLE IF NOT EXISTS appointment_registry (
      appointment_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_appointment_id TEXT NOT NULL,
      customer_name TEXT,
      customer_phone TEXT,
      customer_email TEXT,
      service TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL,
      manage_code_hmac TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      replaced_by_appointment_id TEXT,
      sms_delivery_status TEXT,
      sms_last_error TEXT
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS appointment_registry_manage_code_idx
    ON appointment_registry (manage_code_hmac);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS appointment_registry_provider_lookup_idx
    ON appointment_registry (provider, provider_appointment_id);
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
  initializeDatabase();
  const db = getDatabase();
  db.exec("DELETE FROM appointments;");
  db.exec("DELETE FROM appointment_registry;");
}

function createAppointmentRegistryEntry(entry) {
  getDatabase()
    .prepare(`
      INSERT INTO appointment_registry (
        appointment_id,
        provider,
        provider_appointment_id,
        customer_name,
        customer_phone,
        customer_email,
        service,
        start_time,
        end_time,
        notes,
        status,
        manage_code_hmac,
        created_at,
        updated_at,
        replaced_by_appointment_id,
        sms_delivery_status,
        sms_last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      entry.appointment_id,
      entry.provider,
      entry.provider_appointment_id,
      entry.customer_name || null,
      entry.customer_phone || null,
      entry.customer_email || null,
      entry.service,
      entry.start_time,
      entry.end_time,
      entry.notes || null,
      entry.status,
      entry.manage_code_hmac || null,
      entry.created_at,
      entry.updated_at,
      entry.replaced_by_appointment_id || null,
      entry.sms_delivery_status || null,
      entry.sms_last_error || null
    );
}

function deleteAppointmentRegistryEntry(appointmentId) {
  getDatabase()
    .prepare(`
      DELETE FROM appointment_registry
      WHERE appointment_id = ?
    `)
    .run(appointmentId);
}

function getAppointmentRegistryById(appointmentId) {
  return getDatabase()
    .prepare(`
      SELECT
        appointment_id,
        provider,
        provider_appointment_id,
        customer_name,
        customer_phone,
        customer_email,
        service,
        start_time,
        end_time,
        notes,
        status,
        manage_code_hmac,
        created_at,
        updated_at,
        replaced_by_appointment_id,
        sms_delivery_status,
        sms_last_error
      FROM appointment_registry
      WHERE appointment_id = ?
    `)
    .get(appointmentId) || null;
}

function getManageableAppointmentByCodeHash(manageCodeHmac) {
  return getDatabase()
    .prepare(`
      SELECT
        appointment_id,
        provider,
        provider_appointment_id,
        customer_name,
        customer_phone,
        customer_email,
        service,
        start_time,
        end_time,
        notes,
        status,
        manage_code_hmac,
        created_at,
        updated_at,
        replaced_by_appointment_id,
        sms_delivery_status,
        sms_last_error
      FROM appointment_registry
      WHERE manage_code_hmac = ?
        AND status IN ('confirmed', 'pending_reschedule')
      LIMIT 1
    `)
    .get(manageCodeHmac) || null;
}

function isManageCodeHashInUse(manageCodeHmac) {
  const row = getDatabase()
    .prepare(`
      SELECT appointment_id
      FROM appointment_registry
      WHERE manage_code_hmac = ?
        AND status IN ('confirmed', 'pending_reschedule')
      LIMIT 1
    `)
    .get(manageCodeHmac);

  return Boolean(row);
}

function updateAppointmentRegistrySmsDelivery({ appointmentId, smsDeliveryStatus, smsLastError, updatedAt }) {
  getDatabase()
    .prepare(`
      UPDATE appointment_registry
      SET sms_delivery_status = ?,
          sms_last_error = ?,
          updated_at = ?
      WHERE appointment_id = ?
    `)
    .run(
      smsDeliveryStatus || null,
      smsLastError || null,
      updatedAt,
      appointmentId
    );
}

function markAppointmentRegistryCancelled({ appointmentId, updatedAt }) {
  const info = getDatabase()
    .prepare(`
      UPDATE appointment_registry
      SET status = 'cancelled',
          manage_code_hmac = NULL,
          updated_at = ?
      WHERE appointment_id = ?
        AND status = 'confirmed'
    `)
    .run(updatedAt, appointmentId);

  return info.changes > 0;
}

function markAppointmentRegistryRescheduled({ appointmentId, replacedByAppointmentId, updatedAt }) {
  const info = getDatabase()
    .prepare(`
      UPDATE appointment_registry
      SET status = 'rescheduled',
          replaced_by_appointment_id = ?,
          manage_code_hmac = NULL,
          updated_at = ?
      WHERE appointment_id = ?
        AND status = 'confirmed'
    `)
    .run(replacedByAppointmentId, updatedAt, appointmentId);

  return info.changes > 0;
}

function activatePendingAppointmentRegistryEntry({ appointmentId, updatedAt }) {
  const info = getDatabase()
    .prepare(`
      UPDATE appointment_registry
      SET status = 'confirmed',
          updated_at = ?
      WHERE appointment_id = ?
        AND status = 'pending_reschedule'
    `)
    .run(updatedAt, appointmentId);

  return info.changes > 0;
}

function markAppointmentRegistryRollbackFailed({ appointmentId, updatedAt, errorMessage }) {
  getDatabase()
    .prepare(`
      UPDATE appointment_registry
      SET status = 'rollback_failed',
          manage_code_hmac = NULL,
          sms_last_error = ?,
          updated_at = ?
      WHERE appointment_id = ?
    `)
    .run(errorMessage || null, updatedAt, appointmentId);
}

function listAppointmentRegistryEntries() {
  return getDatabase()
    .prepare(`
      SELECT
        appointment_id,
        provider,
        provider_appointment_id,
        customer_name,
        customer_phone,
        customer_email,
        service,
        start_time,
        end_time,
        notes,
        status,
        manage_code_hmac,
        created_at,
        updated_at,
        replaced_by_appointment_id,
        sms_delivery_status,
        sms_last_error
      FROM appointment_registry
      ORDER BY created_at ASC
    `)
    .all();
}

function finalizeRescheduleTransition({ oldAppointmentId, newAppointmentId, updatedAt }) {
  const db = getDatabase();

  db.exec("BEGIN IMMEDIATE;");

  try {
    const oldInfo = db
      .prepare(`
        UPDATE appointment_registry
        SET status = 'rescheduled',
            replaced_by_appointment_id = ?,
            manage_code_hmac = NULL,
            updated_at = ?
        WHERE appointment_id = ?
          AND status = 'confirmed'
      `)
      .run(newAppointmentId, updatedAt, oldAppointmentId);

    if (oldInfo.changes === 0) {
      throw new Error("Original appointment registry entry is no longer manageable.");
    }

    const newInfo = db
      .prepare(`
        UPDATE appointment_registry
        SET status = 'confirmed',
            updated_at = ?
        WHERE appointment_id = ?
          AND status = 'pending_reschedule'
      `)
      .run(updatedAt, newAppointmentId);

    if (newInfo.changes === 0) {
      throw new Error("Rescheduled appointment registry entry was not pending.");
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

module.exports = {
  DATABASE_PATH,
  activatePendingAppointmentRegistryEntry,
  cancelAppointmentById,
  createAppointment,
  createAppointmentRegistryEntry,
  deleteAppointmentRegistryEntry,
  finalizeRescheduleTransition,
  getAppointmentRegistryById,
  getManageableAppointmentByCodeHash,
  initializeDatabase,
  isManageCodeHashInUse,
  listAppointmentRegistryEntries,
  listAppointments,
  listAppointmentsInRange,
  markAppointmentRegistryCancelled,
  markAppointmentRegistryRescheduled,
  markAppointmentRegistryRollbackFailed,
  resetDatabase,
  updateAppointmentRegistrySmsDelivery
};
