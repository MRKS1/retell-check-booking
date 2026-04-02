const { CONFIG } = require("../config");
const { googleCalendarProvider } = require("./google-calendar-provider");
const { sqliteProvider } = require("./sqlite-provider");

const PROVIDERS = {
  google: googleCalendarProvider,
  sqlite: sqliteProvider
};

function getCalendarProvider() {
  const provider = PROVIDERS[CONFIG.calendarProvider];

  if (!provider) {
    throw new Error(`Unsupported calendar provider: ${CONFIG.calendarProvider}`);
  }

  return provider;
}

function initializeCalendarProvider() {
  const provider = getCalendarProvider();
  provider.initialize();
  return provider;
}

module.exports = {
  getCalendarProvider,
  initializeCalendarProvider
};
