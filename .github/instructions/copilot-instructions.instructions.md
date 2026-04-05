---
description: Describe when these instructions should be loaded by the agent based on task context- This project is a Node.js backend for clinic appointment handling.
- Preserve existing booking behavior unless explicitly asked to change it.
- Prefer small, safe edits over broad rewrites.
- Do not remove working Google Calendar integration code without a replacement.
- Keep route, controller, and service responsibilities separated.
- Validate all user input before processing.
- Always handle missing fields, invalid dates, invalid time slots, and double-booking conflicts.
- Prefer explicit error messages and consistent HTTP status codes.
- When editing booking logic, preserve 10-minute slot rules and clinic schedule constraints.
- Before making changes, explain which files will be affected.
- After changes, summarize risks, edge cases, and suggested tests.
- When generating code, prefer readable JavaScript with clear function names and comments only where useful.
- Avoid introducing unnecessary libraries.
- If a function can fail because of calendar/API/network issues, add defensive error handling.
- When possible, propose tests for booking, canceling, rescheduling, and conflict detection.
applyTo: **/*.js
---

<!-- Tip: Use /create-instructions in chat to generate content with agent assistance -->

Provide project context and coding guidelines that AI should follow when generating code, answering questions, or reviewing changes.