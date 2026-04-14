require('dotenv').config();

const http = require("http");
const {
  bookAppointment,
  cancelAppointment,
  checkAvailability,
  getStoredAppointments,
  lookupBookingByManageCode,
  rescheduleAppointment
} = require("./availability");
const { initializeCalendarProvider } = require("./providers");
const { extractFunctionArgs, formatRetellResponse } = require("./retell");
const { consumeManageCodeRateLimit } = require("./rate-limit");
const { CONFIG } = require("./config");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

initializeCalendarProvider();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function buildHealthPayload() {
  return {
    ok: true,
    service: "check_availability",
    provider: CONFIG.calendarProvider,
    timestamp: new Date().toISOString()
  };
}

function parseRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {http;
      body += chunk.toString();
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

async function handleFunctionResponse(response, requestBody, defaultFunctionName, handler) {
  const context = extractFunctionArgs(requestBody);
  const result = await handler(context.args);
  const statusCode = context.isRetellRequest ? 200 : (result.ok ? 200 : 400);
  const payload = context.isRetellRequest
    ? formatRetellResponse(
      context.functionName || defaultFunctionName,
      result,
      { call: context.call }
    )
    : result;

  sendJson(response, statusCode, payload);
}

function getRequestIpAddress(request) {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.socket && request.socket.remoteAddress
    ? request.socket.remoteAddress
    : null;
}

async function handleManagedFunctionResponse(request, response, defaultFunctionName, handler) {
  const body = await parseRequestBody(request);
  const context = extractFunctionArgs(body);
  const limitResult = consumeManageCodeRateLimit({
    endpoint: defaultFunctionName,
    callId: context.call && context.call.call_id ? context.call.call_id : null,
    ipAddress: getRequestIpAddress(request)
  });

  if (!limitResult.ok) {
    const result = {
      ok: false,
      error: "Too many manage_code attempts. Please try again later."
    };
    const statusCode = context.isRetellRequest ? 200 : 429;
    const payload = context.isRetellRequest
      ? formatRetellResponse(
        context.functionName || defaultFunctionName,
        result,
        { call: context.call }
      )
      : result;

    sendJson(response, statusCode, payload);
    return;
  }

  await handleFunctionResponse(response, body, defaultFunctionName, handler);
}

const server = http.createServer(async (request, response) => {
  // Handle CORS preflight requests
  if (request.method === "OPTIONS") {
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    response.end();
    return;
  }

  if (
    request.method === "GET" &&
    (request.url === "/" || request.url === "/health")
  ) {
    sendJson(response, 200, buildHealthPayload());
    return;
  }

  if (
    request.method === "POST" &&
    (request.url === "/check-availability" || request.url === "/check-available-slots")
  ) {
    try {
      const body = await parseRequestBody(request);
      await handleFunctionResponse(response, body, "check_available_slots", checkAvailability);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error.message
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/book-appointment") {
    try {
      const body = await parseRequestBody(request);
      await handleFunctionResponse(response, body, "book_appointment", bookAppointment);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error.message
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/cancel-appointment") {
    try {
      await handleManagedFunctionResponse(request, response, "cancel_appointment", cancelAppointment);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: "Unable to process the request right now. Please try again later."
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/lookup-booking-by-manage-code") {
    try {
      await handleManagedFunctionResponse(
        request,
        response,
        "lookup_booking_by_manage_code",
        lookupBookingByManageCode
      );
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: "Unable to process the request right now. Please try again later."
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/reschedule-appointment") {
    try {
      await handleManagedFunctionResponse(
        request,
        response,
        "reschedule_appointment",
        rescheduleAppointment
      );
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: "Unable to process the request right now. Please try again later."
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/create-call") {
    try {
      if (!CONFIG.retellApiKey || !CONFIG.retellAgentId) {
        sendJson(response, 500, {
          ok: false,
          error: "Retell configuration missing"
        });
        return;
      }

      const responseFetch = await fetch('https://api.retellai.com/v2/create-web-call', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.retellApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agent_id: CONFIG.retellAgentId
        })
      });

      if (!responseFetch.ok) {
        const errorText = await responseFetch.text();
        console.error('Retell API error:', errorText);
        sendJson(response, 500, {
          ok: false,
          error: 'Failed to create call'
        });
        return;
      }

      const data = await responseFetch.json();
      console.log('Retell API Response:', JSON.stringify(data, null, 2));
      sendJson(response, 200, data);
    } catch (error) {
      console.error('Error creating call:', error.message);
      sendJson(response, 500, {
        ok: false,
        error: 'Failed to create call'
      });
    }
    return;
  }

  if (request.method === "GET" && request.url === "/appointments") {
    sendJson(response, 200, {
      ok: true,
      provider: CONFIG.calendarProvider,
      appointments: await getStoredAppointments()
    });
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: "Not found"
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
