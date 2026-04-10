const { Pool } = require("pg");

let pool;
let schemaInitPromise = null;

function isMirrorEnabled() {
  return process.env.DATABASE_PROVIDER === "postgres" && Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!isMirrorEnabled()) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });
  }

  return pool;
}

async function runQuery(queryText, params = []) {
  const dbPool = getPool();

  if (!dbPool) {
    return;
  }

  await dbPool.query(queryText, params);
}

async function initializeMirrorSchema() {
  if (!isMirrorEnabled()) {
    return;
  }

  if (!schemaInitPromise) {
    schemaInitPromise = (async () => {
      await runQuery(`
        CREATE TABLE IF NOT EXISTS appointment_registry (
          appointment_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          provider_appointment_id TEXT NOT NULL,
          customer_name TEXT,
          customer_phone TEXT,
          customer_email TEXT,
          service TEXT NOT NULL,
          start_time TIMESTAMPTZ NOT NULL,
          end_time TIMESTAMPTZ NOT NULL,
          notes TEXT,
          status TEXT NOT NULL,
          manage_code_hmac TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          replaced_by_appointment_id TEXT,
          sms_delivery_status TEXT,
          sms_last_error TEXT
        );
      `);

      await runQuery(`
        CREATE INDEX IF NOT EXISTS appointment_registry_manage_code_idx
        ON appointment_registry (manage_code_hmac);
      `);

      await runQuery(`
        CREATE INDEX IF NOT EXISTS appointment_registry_provider_lookup_idx
        ON appointment_registry (provider, provider_appointment_id);
      `);

      await runQuery(`
        CREATE TABLE IF NOT EXISTS appointments_mirror (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          provider_appointment_id TEXT NOT NULL,
          customer_name TEXT,
          customer_phone TEXT,
          customer_email TEXT,
          service TEXT NOT NULL,
          start_time TIMESTAMPTZ NOT NULL,
          end_time TIMESTAMPTZ NOT NULL,
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'confirmed',
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
      `);

      await runQuery(`
        CREATE INDEX IF NOT EXISTS appointments_mirror_provider_lookup_idx
        ON appointments_mirror (provider, provider_appointment_id);
      `);

      await runQuery(`
        CREATE INDEX IF NOT EXISTS appointments_mirror_start_time_idx
        ON appointments_mirror (start_time);
      `);
    })();
  }

  await schemaInitPromise;
}

function logMirrorError(action, error) {
  console.warn(`[supabase-mirror] ${action} failed: ${error.message}`);
}

function mirrorPromise(action, promise) {
  promise.catch((error) => {
    logMirrorError(action, error);
  });
}

function upsertAppointmentMirror({ provider, appointment }) {
  mirrorPromise(
    "upsert appointment",
    (async () => {
      await initializeMirrorSchema();
      await runQuery(
        `
          INSERT INTO appointments_mirror (
            id,
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
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (id)
          DO UPDATE SET
            provider = EXCLUDED.provider,
            provider_appointment_id = EXCLUDED.provider_appointment_id,
            customer_name = EXCLUDED.customer_name,
            customer_phone = EXCLUDED.customer_phone,
            customer_email = EXCLUDED.customer_email,
            service = EXCLUDED.service,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            notes = EXCLUDED.notes,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
        `,
        [
          appointment.id,
          provider,
          appointment.provider_appointment_id || appointment.id,
          appointment.customer_name || null,
          appointment.customer_phone || null,
          appointment.customer_email || null,
          appointment.service,
          appointment.start_time,
          appointment.end_time,
          appointment.notes || null,
          appointment.status,
          appointment.created_at,
          new Date().toISOString()
        ]
      );
    })()
  );
}

function markAppointmentMirrorCancelled({ appointmentId }) {
  mirrorPromise(
    "mark appointment cancelled",
    (async () => {
      await initializeMirrorSchema();
      await runQuery(
        `
          UPDATE appointments_mirror
          SET status = 'cancelled',
              updated_at = $2
          WHERE id = $1
        `,
        [appointmentId, new Date().toISOString()]
      );
    })()
  );
}

function upsertAppointmentRegistryMirror(entry) {
  mirrorPromise(
    "upsert appointment registry",
    (async () => {
      await initializeMirrorSchema();
      await runQuery(
        `
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
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
          )
          ON CONFLICT (appointment_id)
          DO UPDATE SET
            provider = EXCLUDED.provider,
            provider_appointment_id = EXCLUDED.provider_appointment_id,
            customer_name = EXCLUDED.customer_name,
            customer_phone = EXCLUDED.customer_phone,
            customer_email = EXCLUDED.customer_email,
            service = EXCLUDED.service,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            notes = EXCLUDED.notes,
            status = EXCLUDED.status,
            manage_code_hmac = EXCLUDED.manage_code_hmac,
            updated_at = EXCLUDED.updated_at,
            replaced_by_appointment_id = EXCLUDED.replaced_by_appointment_id,
            sms_delivery_status = EXCLUDED.sms_delivery_status,
            sms_last_error = EXCLUDED.sms_last_error
        `,
        [
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
        ]
      );
    })()
  );
}

function deleteAppointmentRegistryMirror(appointmentId) {
  mirrorPromise(
    "delete appointment registry",
    (async () => {
      await initializeMirrorSchema();
      await runQuery(
        `
          DELETE FROM appointment_registry
          WHERE appointment_id = $1
        `,
        [appointmentId]
      );
    })()
  );
}

function updateAppointmentRegistrySmsMirror({ appointmentId, smsDeliveryStatus, smsLastError, updatedAt }) {
  mirrorPromise(
    "update registry sms delivery",
    (async () => {
      await initializeMirrorSchema();
      await runQuery(
        `
          UPDATE appointment_registry
          SET sms_delivery_status = $2,
              sms_last_error = $3,
              updated_at = $4
          WHERE appointment_id = $1
        `,
        [appointmentId, smsDeliveryStatus || null, smsLastError || null, updatedAt]
      );
    })()
  );
}

function markAppointmentRegistryCancelledMirror({ appointmentId, updatedAt }) {
  mirrorPromise(
    "mark registry cancelled",
    (async () => {
      await initializeMirrorSchema();
      await runQuery(
        `
          UPDATE appointment_registry
          SET status = 'cancelled',
              manage_code_hmac = NULL,
              updated_at = $2
          WHERE appointment_id = $1
        `,
        [appointmentId, updatedAt]
      );
    })()
  );
}

function markAppointmentRegistryRescheduledMirror({ appointmentId, replacedByAppointmentId, updatedAt }) {
  mirrorPromise(
    "mark registry rescheduled",
    (async () => {
      await initializeMirrorSchema();
      await runQuery(
        `
          UPDATE appointment_registry
          SET status = 'rescheduled',
              replaced_by_appointment_id = $2,
              manage_code_hmac = NULL,
              updated_at = $3
          WHERE appointment_id = $1
        `,
        [appointmentId, replacedByAppointmentId, updatedAt]
      );
    })()
  );
}

function activatePendingAppointmentRegistryEntryMirror({ appointmentId, updatedAt }) {
  mirrorPromise(
    "activate pending registry appointment",
    (async () => {
      await initializeMirrorSchema();
      await runQuery(
        `
          UPDATE appointment_registry
          SET status = 'confirmed',
              updated_at = $2
          WHERE appointment_id = $1
        `,
        [appointmentId, updatedAt]
      );
    })()
  );
}

function markAppointmentRegistryRollbackFailedMirror({ appointmentId, updatedAt, errorMessage }) {
  mirrorPromise(
    "mark registry rollback failed",
    (async () => {
      await initializeMirrorSchema();
      await runQuery(
        `
          UPDATE appointment_registry
          SET status = 'rollback_failed',
              manage_code_hmac = NULL,
              sms_last_error = $2,
              updated_at = $3
          WHERE appointment_id = $1
        `,
        [appointmentId, errorMessage || null, updatedAt]
      );
    })()
  );
}

function finalizeRescheduleTransitionMirror({ oldAppointmentId, newAppointmentId, updatedAt }) {
  mirrorPromise(
    "finalize reschedule transition",
    (async () => {
      await initializeMirrorSchema();
      const dbPool = getPool();

      if (!dbPool) {
        return;
      }

      const client = await dbPool.connect();

      try {
        await client.query("BEGIN");

        await client.query(
          `
            UPDATE appointment_registry
            SET status = 'rescheduled',
                replaced_by_appointment_id = $2,
                manage_code_hmac = NULL,
                updated_at = $3
            WHERE appointment_id = $1
          `,
          [oldAppointmentId, newAppointmentId, updatedAt]
        );

        await client.query(
          `
            UPDATE appointment_registry
            SET status = 'confirmed',
                updated_at = $2
            WHERE appointment_id = $1
          `,
          [newAppointmentId, updatedAt]
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })()
  );
}

function clearMirrorData() {
  mirrorPromise(
    "clear mirror data",
    (async () => {
      await initializeMirrorSchema();
      await runQuery("DELETE FROM appointment_registry");
      await runQuery("DELETE FROM appointments_mirror");
    })()
  );
}

module.exports = {
  activatePendingAppointmentRegistryEntryMirror,
  clearMirrorData,
  deleteAppointmentRegistryMirror,
  finalizeRescheduleTransitionMirror,
  initializeMirrorSchema,
  markAppointmentMirrorCancelled,
  markAppointmentRegistryCancelledMirror,
  markAppointmentRegistryRescheduledMirror,
  markAppointmentRegistryRollbackFailedMirror,
  updateAppointmentRegistrySmsMirror,
  upsertAppointmentMirror,
  upsertAppointmentRegistryMirror
};