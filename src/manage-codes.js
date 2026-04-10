const crypto = require("crypto");
const { CONFIG } = require("./config");
const { isManageCodeHashInUse } = require("./db");

function randomDigit() {
  return crypto.randomInt(0, 10).toString();
}

function generateManageCodeDigits(length) {
  let code = "";

  for (let index = 0; index < length; index++) {
    code += randomDigit();
  }

  return code;
}

function normalizeManageCode(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).replace(/\D/g, "");
}

function validateManageCode(value) {
  const manageCode = normalizeManageCode(value);

  if (!manageCode) {
    return {
      ok: false,
      error: "Missing required field: manage_code"
    };
  }

  if (manageCode.length !== CONFIG.manageCodeLength) {
    return {
      ok: false,
      error: `Invalid manage_code format. Expected ${CONFIG.manageCodeLength} digits.`
    };
  }

  return {
    ok: true,
    manageCode
  };
}

function hashManageCode(manageCode) {
  return crypto
    .createHmac("sha256", CONFIG.manageCodeSecret)
    .update(manageCode)
    .digest("hex");
}

function formatManageCodeForSpeech(manageCode) {
  return manageCode.split("").join(" ");
}

function createManageCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const manageCode = generateManageCodeDigits(CONFIG.manageCodeLength);
    const manageCodeHmac = hashManageCode(manageCode);

    if (!isManageCodeHashInUse(manageCodeHmac)) {
      return {
        manageCode,
        manageCodeHmac
      };
    }
  }

  throw new Error("Unable to generate a unique manage code.");
}

module.exports = {
  createManageCode,
  formatManageCodeForSpeech,
  hashManageCode,
  normalizeManageCode,
  validateManageCode
};
