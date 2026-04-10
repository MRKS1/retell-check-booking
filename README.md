# check_availability backend

Node.js booking backend pripraveny pre Retell AI, Render deploy a 2 calendar providery:

- `sqlite` pre lokalny vyvoj alebo jednoduchy deploy
- `google` pre realne rezervacie zapisovane priamo do Google Calendar

## Endpointy

- `GET /health`
- `GET /appointments`
- `POST /check-available-slots`
- `POST /book-appointment`
- `POST /lookup-booking-by-manage-code`
- `POST /cancel-appointment`
- `POST /reschedule-appointment`

Stare `POST /check-availability` ostava ako kompatibilny alias.

## Lokalny start

```bash
npm start
```

## Env premenne

Pouzi `.env.example` ako sablonu.

Najdolezitejsia je:

```bash
CALENDAR_PROVIDER=sqlite
```

alebo:

```bash
CALENDAR_PROVIDER=google
```

Pre Google provider budes potrebovat:

- `GOOGLE_CALENDAR_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Pre volitelny Supabase mirror (na admin prehlad rezervacii) nastav:

- `DATABASE_PROVIDER=postgres`
- `DATABASE_URL=postgresql://...` (Supabase transaction pooler URI)

Poznamka: Google Calendar ostava hlavny booking kanal. Supabase sa pouziva ako mirror evidencie.

## Google Calendar flow

Odporucany setup je:

1. vytvorit service account v Google Cloud
2. zapnut Calendar API
3. zdielat konkretne Google Calendar s emailom service accountu
4. vlozit credentials do Render environment variables
5. nastavit `CALENDAR_PROVIDER=google`

## Render deploy

V projekte je pripraveny `render.yaml`.

Po deployi budes mat stabilnu Render URL typu:

```text
https://your-service.onrender.com
```

Retell potom napojis na:

- `https://your-service.onrender.com/check-available-slots`
- `https://your-service.onrender.com/book-appointment`
- `https://your-service.onrender.com/lookup-booking-by-manage-code`
- `https://your-service.onrender.com/cancel-appointment`
- `https://your-service.onrender.com/reschedule-appointment`

## Test requesty

Check dostupnych slotov:

```bash
curl -X POST http://localhost:3000/check-available-slots \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-04-03",
    "duration_minutes": 30
  }'
```

Booking:

```bash
curl -X POST http://localhost:3000/book-appointment \
  -H "Content-Type: application/json" \
  -d '{
    "start_time": "2026-04-03T10:00:00+02:00",
    "duration_minutes": 30,
    "customer_name": "Jane Doe",
    "customer_phone": "+421900000000",
    "customer_email": "jane@example.com",
    "service": "vstupne_vysetrenie"
  }'
```

Book response now returns:

- `manage_code`
- `manage_code_delivery`

Lookup:

```bash
curl -X POST http://localhost:3000/lookup-booking-by-manage-code \
  -H "Content-Type: application/json" \
  -d '{
    "manage_code": "42816357"
  }'
```

Cancel:

```bash
curl -X POST http://localhost:3000/cancel-appointment \
  -H "Content-Type: application/json" \
  -d '{
    "manage_code": "42816357"
  }'
```

Reschedule:

```bash
curl -X POST http://localhost:3000/reschedule-appointment \
  -H "Content-Type: application/json" \
  -d '{
    "manage_code": "42816357",
    "new_start_time": "2026-04-03T10:20:00+02:00"
  }'
```

## Retell

Schema subory pre Retell su v priecinku `retell/`:

- `check_availability.schema.json`
- `book_appointment.schema.json`
- `lookup_booking_by_manage_code.schema.json`
- `cancel_appointment.schema.json`
- `reschedule_appointment.schema.json`
- `setup.md`
