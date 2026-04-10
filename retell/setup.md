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
- Description: `Book an appointment after the caller confirms a specific time slot. Returns an 8-digit manage code for cancellation or reschedule.`
- Method: `POST`
- URL: `https://YOUR_PUBLIC_URL/book-appointment`
- Payload: odporucane zapni `Payload: args only`
- Parameters: vloz obsah `retell/book_appointment.schema.json`

## Function 3: `lookup_booking_by_manage_code`

- Name: `lookup_booking_by_manage_code`
- Description: `Look up an existing booking by the 8-digit manage code before cancel or reschedule.`
- Method: `POST`
- URL: `https://YOUR_PUBLIC_URL/lookup-booking-by-manage-code`
- Payload: odporucane zapni `Payload: args only`
- Parameters: vloz obsah `retell/lookup_booking_by_manage_code.schema.json`

## Function 4: `cancel_appointment`

- Name: `cancel_appointment`
- Description: `Cancel an existing appointment when the caller gives a valid 8-digit manage code.`
- Method: `POST`
- URL: `https://YOUR_PUBLIC_URL/cancel-appointment`
- Payload: odporucane zapni `Payload: args only`
- Parameters: vloz obsah `retell/cancel_appointment.schema.json`

## Function 5: `reschedule_appointment`

- Name: `reschedule_appointment`
- Description: `Move an existing appointment to a new free slot of the same service when the caller gives a valid 8-digit manage code.`
- Method: `POST`
- URL: `https://YOUR_PUBLIC_URL/reschedule-appointment`
- Payload: odporucane zapni `Payload: args only`
- Parameters: vloz obsah `retell/reschedule_appointment.schema.json`

## Prompt instrukcia pre node

```text
You help callers book medical appointments at a clinic. Working hours are Monday–Friday 7:00–15:00.

STEP 1: Determine the type of appointment. Ask the caller what they need:
- Športová prehliadka (sports medical exam) — available 7:00–8:40, 20-min slots
- Vstupné vyšetrenie (initial visit) — available 9:00–11:50, 10-min slots
- Kontrolné vyšetrenie (follow-up) — available 13:00–14:30, 10-min slots
- Zdravotnícka pomôcka (medical device prescription) — available 9:00–11:50 or 13:00–14:30, max 1 per day
- Konzultácia (express paid consultation, 30 €) — available 14:40–14:50, only 2 slots per day

STEP 2: Use check_available_slots with the correct service value to find open times.
If the caller gives an exact time, pass start_time in ISO 8601 with timezone offset.
If the caller only gives a day, pass date in YYYY-MM-DD.
Always pass the service parameter.

STEP 3: Before booking, collect customer_name and customer_phone.

STEP 4: Use book_appointment only after the caller confirms a specific slot.
If check_available_slots returns unavailable, offer the next_available_slots to the caller.
Never promise a booking until book_appointment succeeds.
After a successful booking, tell the caller the returned manage_code slowly digit by digit and ask them to write it down.

STEP 5: If the caller wants to cancel or reschedule, ask for the 8-digit manage code first.
If they do not know the manage code, explain that self-service is not available and they must contact the clinic reception.

STEP 6: Use lookup_booking_by_manage_code before cancel_appointment or reschedule_appointment.
Repeat the found booking details back to the caller before taking action.

STEP 7: Use reschedule_appointment only for moving the booking to a new time of the same service.
If the caller wants a different service type, do not use reschedule_appointment. Start a new booking flow or direct them to reception.

IMPORTANT PATIENT INSTRUCTIONS — tell the caller AFTER they choose a service:
- Športová prehliadka: "Musíte prísť nalačno, bude vám odoberaná krv a moč. Doneste si jedlo, vodu, športové oblečenie a uterák. Samotné vyšetrenie trvá 40–60 minút."
- Vstupné vyšetrenie: "Prineste si výmenný lístok od lekára, kartičku poistenca a zdravotnú kartu. Ak vám bolo robené zobrazovacie vyšetrenie, doneste správu alebo CD."
- Kontrolné vyšetrenie: "Doneste si dekurz, ktorý ste dostali na vstupnom vyšetrení."
- Konzultácia: "Konzultácia je platená služba za 30 €."

The response from check_available_slots includes a patient_info field — use it to inform the caller.

Use lookup_booking_by_manage_code, cancel_appointment and reschedule_appointment only when the caller gives the manage_code.
```

## Poznamka

Server podporuje aj standardny Retell wrapper request s `name`, `call` a `args`, ale `Payload: args only` je jednoduchsie nastavenie pre tento backend.
