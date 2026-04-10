const { CONFIG } = require("../config");
const { consoleSmsProvider } = require("./providers/console-provider");
const { noopSmsProvider } = require("./providers/noop-provider");
const { webhookSmsProvider } = require("./providers/webhook-provider");

const SMS_PROVIDERS = {
  console: consoleSmsProvider,
  noop: noopSmsProvider,
  webhook: webhookSmsProvider
};

function registerSmsProvider(name, provider) {
  SMS_PROVIDERS[name] = provider;
}

function getSmsProvider(providerName = CONFIG.smsProvider) {
  const provider = SMS_PROVIDERS[providerName];

  if (!provider) {
    throw new Error(`Unsupported SMS provider: ${providerName}`);
  }

  return provider;
}

async function deliverManageCode({ manageCode, appointment }) {
  const phoneNumber = appointment.customer_phone;
  const speech = manageCode.split("").join(" ");
  const configuredProviderName = CONFIG.smsProvider;

  if (!phoneNumber) {
    return {
      mode: "voice_only",
      sms_status: "skipped",
      provider: null,
      speech,
      error: "No customer phone number available for SMS delivery."
    };
  }

  try {
    const provider = getSmsProvider(configuredProviderName);

    if (provider.name === "noop") {
      return {
        mode: "voice_only",
        sms_status: "skipped",
        provider: provider.name,
        speech,
        error: "SMS delivery skipped by configuration."
      };
    }

    const message = [
      `Kod na spravu rezervacie: ${manageCode}.`,
      `Termin: ${appointment.start_time}.`,
      `Sluzba: ${appointment.service}.`
    ].join(" ");

    await provider.sendSms({
      to: phoneNumber,
      message,
      metadata: {
        appointment_id: appointment.id,
        service: appointment.service,
        start_time: appointment.start_time
      }
    });

    return {
      mode: "sms_and_voice",
      sms_status: "sent",
      provider: provider.name,
      speech,
      error: null
    };
  } catch (error) {
    return {
      mode: "voice_only",
      sms_status: "failed",
      provider: configuredProviderName,
      speech,
      error: error.message
    };
  }
}

module.exports = {
  deliverManageCode,
  getSmsProvider,
  registerSmsProvider
};
