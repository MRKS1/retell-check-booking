const consoleSmsProvider = {
  name: "console",

  async sendSms({ to, message }) {
    console.log(`[sms:console] to=${to} message=${message}`);
    return {
      accepted: true
    };
  }
};

module.exports = { consoleSmsProvider };
