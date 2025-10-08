# Undervalued Estate — Migration off Netlify (Render + Cloudflare Workers)

This document describes how to fully migrate away from Netlify:
- Backend API runs on Render (Node Web Service)
- Frontend SPA is a Render Static Site (Vite build)
- Scheduler uses Cloudflare Workers Cron to hit API endpoints every 15 minutes

## Overview of changes
- API defined in `render.yaml` service `undervalued-estate-api` (rootDirectory: `server/`).
- Frontend defined in `render.yaml` static site `undervalued-estate-frontend` (rootDirectory: `frontend/`).
- Netlify configs and functions are deprecated and can be removed (`netlify.toml`, `netlify/`).
- Cloudflare Worker lives in `cloudflare/` with cron trigger configured in `cloudflare/wrangler.toml`.

## 1) Deploy the API to Render
1. Create a new Web Service on Render from this repo.
2. Render will automatically detect `render.yaml` and provision the `undervalued-estate-api` service.
3. Confirm the service settings:
   - Root directory: `server`
   - Build command: `NPM_CONFIG_PRODUCTION=false npm ci && npm run build`
   - Start command: `npm run start` (uses `tsx src/index.ts`)
   - Health check path: `/health`
4. Set environment variables on the service:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `API_SECRET` (used by the scheduler to call protected endpoints)
   - `GMAIL_USER`, `GMAIL_PASS` (App Password recommended)
5. Deploy and verify: `https://<api-service>.onrender.com/health` returns 200.

Note: Express already listens on `process.env.PORT`. CORS is enabled via `cors()`.

## 2) Deploy the Frontend to Render Static Sites
1. Create a Render Static Site from this repo.
2. Render will use `render.yaml` `staticSites` entry named `undervalued-estate-frontend`.
3. Confirm:
   - Root directory: `frontend`
   - Build command: `npm ci && npm run build`
   - Publish directory: `dist`
4. Set environment variables for the site:
   - `VITE_API_URL` = `https://<api-service>.onrender.com`
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
5. Deploy and verify the SPA loads and calls `GET <VITE_API_URL>/api/properties` successfully.

## 3) Set up Cloudflare Worker Cron (Scheduler)
1. Install Wrangler locally: `npm i -g wrangler` (or use `npx wrangler`).
2. Log in: `wrangler login`.
3. From the `cloudflare/` directory:
   - Set secrets:
     - `wrangler secret put API_URL` → `https://<api-service>.onrender.com`
     - `wrangler secret put API_SECRET` → same secret configured on the API service
   - Deploy the worker: `wrangler deploy`
4. The cron is defined in `cloudflare/wrangler.toml` as `*/15 * * * *`.
5. The worker function `src/worker.ts` will:
   - POST `/api/scrape/run` (NPC and Properstar runs)
   - POST `/api/scrape/benchmarks/refresh`
   - POST `/api/alerts/dispatch`

## 4) Remove Netlify
- Delete the following from the repo once Render + Cloudflare are green:
  - `netlify.toml`
  - `netlify/` directory (functions)
  - Optional: `.netlify/` local folder
- In Netlify dashboard, disable or delete the site to stop charges.

## 5) Frontend runtime config
The SPA reads `VITE_API_URL` at build time (see `frontend/src/pages/App.tsx`). Set it in the Render Static Site env. If omitted, the SPA falls back to `window.location.origin`, which is not the API host in this architecture.

## 6) Notes on costs
- Render Free plan works for prototyping; upgrade if uptime or instance size becomes a constraint.
- Cloudflare Workers Cron is extremely cost-effective for periodic HTTP calls.

## 7) Troubleshooting
- 403 or 401 from protected endpoints: ensure `API_SECRET` matches in both Render API and Cloudflare Worker secrets.
- CORS errors in browser: `cors()` is enabled without a fixed origin; if you tighten CORS later, include your frontend domain.
- Long scraping runs: consider staggering concurrency or raising timeouts in the scheduler payload.
