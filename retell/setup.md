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

IMPORTANT PATIENT INSTRUCTIONS — tell the caller AFTER they choose a service:
- Športová prehliadka: "Musíte prísť nalačno, bude vám odoberaná krv a moč. Doneste si jedlo, vodu, športové oblečenie a uterák. Samotné vyšetrenie trvá 40–60 minút."
- Vstupné vyšetrenie: "Prineste si výmenný lístok od lekára, kartičku poistenca a zdravotnú kartu. Ak vám bolo robené zobrazovacie vyšetrenie, doneste správu alebo CD."
- Kontrolné vyšetrenie: "Doneste si dekurz, ktorý ste dostali na vstupnom vyšetrení."
- Konzultácia: "Konzultácia je platená služba za 30 €."

The response from check_available_slots includes a patient_info field — use it to inform the caller.

Use cancel_appointment only when the caller wants to cancel an existing booking and you have the appointment_id.
```

## Poznamka

Server podporuje aj standardny Retell wrapper request s `name`, `call` a `args`, ale `Payload: args only` je jednoduchsie nastavenie pre tento backend.
