function isRetellFunctionRequest(body) {
  return Boolean(body && typeof body === "object" && body.args && typeof body.args === "object");
}

function extractFunctionArgs(body) {
  if (isRetellFunctionRequest(body)) {
    return {
      isRetellRequest: true,
      functionName: body.name || null,
      call: body.call || null,
      args: body.args
    };
  }

  return {
    isRetellRequest: false,
    functionName: null,
    call: null,
    args: body
  };
}

function formatSlots(slots) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return "No alternative slots found.";
  }

  return slots
    .slice(0, 3)
    .map((slot) => `${slot.start} to ${slot.end}`)
    .join("; ");
}

function buildSummary(functionName, result) {
  if (!result.ok) {
    const suffix = result.next_available_slots
      ? ` Next options: ${formatSlots(result.next_available_slots)}`
      : "";
    return `${result.error || "Function failed."}${suffix}`;
  }

  if (functionName === "book_appointment") {
    return `Appointment booked for ${result.appointment.start_time}.`;
  }

  if (result.requested_start && result.available) {
    return `The requested slot at ${result.requested_start} is available.`;
  }

  if (result.requested_start && !result.available) {
    return `The requested slot at ${result.requested_start} is not available. Next options: ${formatSlots(result.next_available_slots)}`;
  }

  if (result.date) {
    return `Found ${result.available_slots.length} available slots on ${result.date}.`;
  }

  return "Function completed successfully.";
}

function formatRetellResponse(functionName, result, context = {}) {
  return {
    ok: result.ok,
    function_name: functionName,
    call_id: context.call && context.call.call_id ? context.call.call_id : null,
    summary: buildSummary(functionName, result),
    data: result
  };
}

module.exports = {
  extractFunctionArgs,
  formatRetellResponse,
  isRetellFunctionRequest
};
