const http = require("http");
const {
  bookAppointment,
  cancelAppointment,
  checkAvailability,
  getStoredAppointments
} = require("./availability");
const { initializeCalendarProvider } = require("./providers");
const { extractFunctionArgs, formatRetellResponse } = require("./retell");
const { CONFIG } = require("./config");

const PORT = process.env.PORT || 3000;

initializeCalendarProvider();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function parseRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
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

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "check_availability",
      provider: CONFIG.calendarProvider,
      timestamp: new Date().toISOString()
    });
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
      const body = await parseRequestBody(request);
      await handleFunctionResponse(response, body, "cancel_appointment", cancelAppointment);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error.message
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

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
