const noopSmsProvider = {
  name: "noop",

  async sendSms() {
    return {
      accepted: false,
      skipped: true
    };
  }
};

module.exports = { noopSmsProvider };
