const {
  cancelAppointmentById,
  createAppointment,
  initializeDatabase,
  listAppointmentsInRange
} = require("../db");

const sqliteProvider = {
  name: "sqlite",

  initialize() {
    initializeDatabase();
  },

  async listAppointments({ startDate, endDate }) {
    return listAppointmentsInRange({
      startDate: startDate ? startDate.toISOString() : null,
      endDate: endDate ? endDate.toISOString() : null
    });
  },

  async createAppointment(appointment) {
    createAppointment(appointment);
    return {
      ...appointment,
      provider_appointment_id: appointment.id
    };
  },

  async cancelAppointment({ appointmentId }) {
    return cancelAppointmentById(appointmentId);
  }
};

module.exports = { sqliteProvider };
