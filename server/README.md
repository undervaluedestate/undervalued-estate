# Undervalued Estate - Backend (Express)

## Setup

1. Copy environment file
```
cp .env.example .env
```
Fill values for Supabase and Gmail SMTP.

2. Install dependencies
```
npm install
```

3. Run development server
```
npm run dev
```

The server runs on `http://localhost:4000` by default.

## Environment variables
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `PORT` (default 4000)
- `API_SECRET` for protected job endpoints
- `GMAIL_USER`, `GMAIL_PASS` for Nodemailer (App Password recommended)

## Routes
- `GET /health` health check
- `GET /api/properties` query properties with filters
- `GET /api/benchmarks` current benchmarks
- `GET /api/alerts` (auth) list user's alerts
- `POST /api/alerts` (auth) create alert
- `POST /api/scrape/run` (protected) trigger scraping job
- `POST /api/benchmarks/refresh` (protected) refresh benchmarks

## Notes on Auth
For user routes, pass `Authorization: Bearer <access_token>` from Supabase Auth. The server validates the token with Supabase and uses the `user.id`.

## Realtime Updates
Supabase Realtime can be enabled on `properties`, `benchmarks`, or views. The frontend can subscribe to table changes to get live updates as new deals are ingested. This backend does not need websockets to broadcast; inserts/updates in Supabase will trigger realtime streams directly to clients.
