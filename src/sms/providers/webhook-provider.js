const { CONFIG } = require("../../config");

const webhookSmsProvider = {
  name: "webhook",

  async sendSms({ to, message, metadata }) {
    if (!CONFIG.smsWebhookUrl) {
      throw new Error("Missing required environment variable: SMS_WEBHOOK_URL");
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (CONFIG.smsWebhookAuthHeader && CONFIG.smsWebhookAuthValue) {
      headers[CONFIG.smsWebhookAuthHeader] = CONFIG.smsWebhookAuthValue;
    }

    const response = await fetch(CONFIG.smsWebhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: CONFIG.smsFrom,
        to,
        message,
        metadata
      })
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`SMS webhook request failed: ${responseText}`);
    }

    return {
      accepted: true
    };
  }
};

module.exports = { webhookSmsProvider };
