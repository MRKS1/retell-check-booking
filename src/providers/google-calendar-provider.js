const crypto = require("crypto");

let accessTokenCache = null;

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getGoogleConfig() {
  const privateKey = getRequiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  return {
    calendarId: getRequiredEnv("GOOGLE_CALENDAR_ID"),
    clientEmail: getRequiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey
  };
}

function base64UrlEncode(input) {
  return Buffer
    .from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildServiceAccountJwt() {
  const { clientEmail, privateKey } = getGoogleConfig();
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();

  const signature = signer
    .sign(privateKey, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${unsignedToken}.${signature}`;
}

async function getAccessToken() {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) {
    return accessTokenCache.token;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildServiceAccountJwt()
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch Google access token: ${errorText}`);
  }

  const json = await response.json();
  accessTokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in * 1000)
  };

  return accessTokenCache.token;
}

async function googleCalendarRequest(pathname, options = {}) {
  const { calendarId } = getGoogleConfig();
  const token = await getAccessToken();
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}${pathname}`
  );

  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Calendar request failed: ${errorText}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function mapGoogleEvent(event) {
  return {
    id: event.id,
    customer_name: event.summary || null,
    customer_phone: null,
    customer_email: event.attendees && event.attendees[0] ? event.attendees[0].email : null,
    service: event.extendedProperties && event.extendedProperties.private
      ? event.extendedProperties.private.service || "google_calendar_event"
      : "google_calendar_event",
    start_time: event.start.dateTime,
    end_time: event.end.dateTime,
    notes: event.description || null,
    status: "confirmed",
    created_at: event.created || new Date().toISOString()
  };
}

function buildEventDescription(appointment) {
  const lines = [
    `Customer: ${appointment.customer_name || "Unknown"}`,
    `Phone: ${appointment.customer_phone || "N/A"}`,
    `Email: ${appointment.customer_email || "N/A"}`,
    `Service: ${appointment.service}`,
    `Notes: ${appointment.notes || "N/A"}`,
    `Local appointment id: ${appointment.id}`
  ];

  return lines.join("\n");
}

const googleCalendarProvider = {
  name: "google",

  initialize() {
    getGoogleConfig();
  },

  async listAppointments({ startDate, endDate }) {
    const response = await googleCalendarRequest("/events", {
      query: {
        singleEvents: "true",
        orderBy: "startTime",
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString()
      }
    });

    return response.items
      .filter((event) => event.status !== "cancelled" && event.start && event.start.dateTime)
      .map(mapGoogleEvent);
  },

  async createAppointment(appointment) {
    const event = await googleCalendarRequest("/events", {
      method: "POST",
      body: {
        summary: appointment.customer_name
          ? `${appointment.service} - ${appointment.customer_name}`
          : appointment.service,
        description: buildEventDescription(appointment),
        start: {
          dateTime: appointment.start_time,
          timeZone: "Europe/Bratislava"
        },
        end: {
          dateTime: appointment.end_time,
          timeZone: "Europe/Bratislava"
        },
        extendedProperties: {
          private: {
            service: appointment.service,
            local_appointment_id: appointment.id
          }
        }
      }
    });

    return {
      ...appointment,
      id: event.id,
      created_at: event.created || appointment.created_at
    };
  },

  async cancelAppointment({ appointmentId }) {
    try {
      await googleCalendarRequest(`/events/${encodeURIComponent(appointmentId)}`, {
        method: "DELETE"
      });
      return true;
    } catch (error) {
      if (error.message.includes("Not Found")) {
        return false;
      }
      throw error;
    }
  }
};

module.exports = { googleCalendarProvider };
