const { CONFIG } = require("../config");
const { initializeDatabase } = require("../db");
const { googleCalendarProvider } = require("./google-calendar-provider");
const { sqliteProvider } = require("./sqlite-provider");

const PROVIDERS = {
  google: googleCalendarProvider,
  sqlite: sqliteProvider
};

function registerCalendarProvider(name, provider) {
  PROVIDERS[name] = provider;
}

function getCalendarProvider(providerName = CONFIG.calendarProvider) {
  const provider = PROVIDERS[providerName];

  if (!provider) {
    throw new Error(`Unsupported calendar provider: ${providerName}`);
  }

  return provider;
}

function initializeCalendarProvider() {
  initializeDatabase();
  const provider = getCalendarProvider();
  provider.initialize();
  return provider;
}

module.exports = {
  getCalendarProvider,
  initializeCalendarProvider,
  registerCalendarProvider
};
