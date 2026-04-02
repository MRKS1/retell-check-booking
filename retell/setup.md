# Retell setup

Pouzi `Custom Function` v Retell dashboarde.

## Function 1: `check_available_slots`

- Name: `check_available_slots`
- Description: `Check whether a requested appointment time is free, or list available appointment slots for a requested date.`
- Method: `POST`
- URL: `https://YOUR_PUBLIC_URL/check-available-slots`
- Payload: odporucane zapni `Payload: args only`
- Parameters: vloz obsah `retell/check_availability.schema.json`

## Function 2: `book_appointment`

- Name: `book_appointment`
- Description: `Book an appointment after the caller confirms a specific time slot.`
- Method: `POST`
- URL: `https://YOUR_PUBLIC_URL/book-appointment`
- Payload: odporucane zapni `Payload: args only`
- Parameters: vloz obsah `retell/book_appointment.schema.json`

## Function 3: `cancel_appointment`

- Name: `cancel_appointment`
- Description: `Cancel an existing appointment when the caller gives the appointment id or when your flow already knows it.`
- Method: `POST`
- URL: `https://YOUR_PUBLIC_URL/cancel-appointment`
- Payload: odporucane zapni `Payload: args only`
- Parameters: vloz obsah `retell/cancel_appointment.schema.json`

## Prompt instrukcia pre node

```text
You help callers book appointments.

Use check_available_slots when the caller asks for open times, asks whether a time is available, or gives a preferred day.
If the caller gives an exact time, pass start_time in ISO 8601 with timezone offset.
If the caller only gives a day, pass date in YYYY-MM-DD.

Use book_appointment only after the caller confirms a specific slot.
Before booking, collect customer_name and customer_phone when possible.
If check_available_slots returns unavailable, offer the next_available_slots to the caller.
Never promise a booking until book_appointment succeeds.
Use cancel_appointment only when the caller wants to cancel an existing booking and you have the appointment_id.
```

## Poznamka

Server podporuje aj standardny Retell wrapper request s `name`, `call` a `args`, ale `Payload: args only` je jednoduchsie nastavenie pre tento backend.
