const CONFIG = {
  timezone: "Europe/Bratislava",
  calendarProvider: process.env.CALENDAR_PROVIDER || "sqlite",
  businessHours: {
    monday: ["09:00", "17:00"],
    tuesday: ["09:00", "17:00"],
    wednesday: ["09:00", "17:00"],
    thursday: ["09:00", "17:00"],
    friday: ["09:00", "17:00"],
    saturday: null,
    sunday: null
  },
  defaultDurationMinutes: 30,
  slotIntervalMinutes: 30,
  maxSuggestions: 5,
  availabilitySearchDays: 30
};

module.exports = { CONFIG };
