# Asscher AI — Operations Platform

A secure, private, invitation-only, mobile-responsive web app that runs the entire day-to-day
operation of **Asscher AI**: task assignment with cascade/breakdown, daily reporting that rolls
up the org tree, queries & 🔴 alerts with escalation, requirements inbox, employee records,
stipends, leaves & holidays, streaks, a protected training-video library, and an encrypted
company credentials vault — all behind one login, permission-scoped at every level,
**enforced server-side**, with an append-only audit log. Nothing is ever hard-deleted.

App timezone: **Asia/Kolkata (IST)** · Currency: **₹ INR**

The project is split into two independently hostable apps:

```
asscher-ai/
├── backend/    → Node.js + Express + Prisma 7 + PostgreSQL  (host on Render/Railway/anywhere)
├── frontend/   → React + Vite + Tailwind SPA (pure static)  (host on Vercel/Netlify/anywhere)
└── render.yaml → optional one-click Render blueprint for the backend
```

The frontend talks to the backend over HTTPS using a URL **you paste in** — either the
`VITE_API_URL` environment variable (build time) or `frontend/public/config.js` (runtime, no rebuild).

---

## 1. Deploy the database (Neon — free)

1. Go to https://neon.tech → create a project (region: Asia Pacific / Singapore is closest to IST).
2. Copy the **connection string** (looks like
   `postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`).

(Supabase or Railway Postgres work identically — you just need a `DATABASE_URL`.)

## 2. Deploy the backend (Render — free tier works)

**Option A — Blueprint (easiest):** push this repo to GitHub → Render dashboard → *New + → Blueprint* →
select the repo. Render reads `render.yaml`; fill in the env vars it asks for.

**Option B — manual:** *New + → Web Service* → pick the repo →
- **Root directory:** `backend`
- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`   (this runs `prisma db push` — creates/updates all tables — then boots the API)
- **Environment variables:**

| Variable | Value |
|---|---|
| `DATABASE_URL` | your Neon connection string |
| `FRONTEND_ORIGIN` | your frontend URL, e.g. `https://asscher-ai.vercel.app` (comma-separate several) |
| `VAULT_ENCRYPTION_KEY` | a long random secret. **Set once, never change it**, or stored vault passwords become unreadable |
| `SEED_ADMIN_USERNAME` | first Primary Admin username (e.g. `admin`) |
| `SEED_ADMIN_EMAIL` | first Primary Admin email |
| `SEED_ADMIN_PASSWORD` | first Primary Admin password (change after first login) |

On first boot with an empty database the server creates the one Primary Admin account from those
seed variables. Your API URL will look like `https://asscher-ai-backend.onrender.com` —
open `/api/health` to confirm it's alive.

> **Free-tier note:** Render free instances sleep when idle, so the 00:05 IST cron may fire late.
> The app is built for this: every job (streak evaluation, recurring-task spawning, stipend
> generation, renewal reminders) also runs via **lazy catch-up** on boot and on dashboard loads,
> so results are always correct. Upgrade the instance to keep it always-on.

## 3. Deploy the frontend (Vercel — free)

1. Vercel → *Add New → Project* → import the repo.
2. **Root directory:** `frontend` (framework auto-detected: Vite).
3. Add environment variable **`VITE_API_URL`** = your backend URL
   (e.g. `https://asscher-ai-backend.onrender.com` — no trailing slash) → Deploy.

**This is "the server part of the front end where you paste the backend URL."** Two ways, pick either:
- `VITE_API_URL` env var on Vercel (redeploy to apply), **or**
- edit `frontend/public/config.js` and put the URL in `window.APP_CONFIG.API_URL`
  (works even after build, on any static host).

Finally, make sure the backend's `FRONTEND_ORIGIN` matches your Vercel URL exactly
(scheme + domain, no trailing slash), or the browser will block API calls (CORS).

Netlify works identically (`frontend/public/_redirects` is already included for SPA routing).

## 4. First login

Sign in with the seed admin credentials → change your password → **People → ＋ Add person** to
build the org tree (there is **no public signup**; you set every username & password, with a
"generate strong password" button). Assign each person a manager — headship is relative and the
tree can be any depth.

---

## Local development

```bash
# backend
cd backend
cp .env.example .env          # fill DATABASE_URL etc.
npm install
npx prisma db push            # creates the tables (fallback if CLI can't reach engine downloads: psql "$DATABASE_URL" -f prisma/schema.sql)
npm run db:seed               # optional; SEED_DEMO_DATA=true adds a demo org (password: Password@123)
npm run dev                   # → http://localhost:4000

# frontend (second terminal)
cd frontend
npm install
npm run dev                   # → http://localhost:5173 (talks to localhost:4000 by default)
```

`backend/smoke-test.mjs` runs 75 API acceptance tests against a running local backend:
`node smoke-test.mjs`.

---

## Feature map → where it lives

| Area | Backend | Frontend |
|---|---|---|
| Auth, device limit (1 per user / 5 for Primary Admin), sessions panel | `src/routes/auth.ts`, `src/middleware/auth.ts` | `pages/Login.tsx`, `pages/Settings.tsx` |
| Org tree, profiles, offboarding + exit checklist, performance | `src/routes/users.ts`, `src/lib/org.ts` | `pages/People.tsx`, `pages/PersonProfile.tsx` |
| Tasks: cascade/breakdown, protocols & templates, resources, read receipts, submissions & review loop, recurring | `src/routes/tasks.ts`, `src/lib/jobs.ts` | `pages/TaskForm.tsx`, `pages/TaskDetail.tsx` |
| Daily report chain, compile-&-forward, admin day view, **Day Report PDF + archive**, CSV | `src/routes/reports.ts` | `pages/Reports.tsx` |
| Queries / 🔴 alerts / escalation trail, Requirements inbox → one-click task | `src/routes/queries.ts` | `pages/Queries.tsx`, `pages/QueryDetail.tsx` |
| Stipends (auto due records, overdue red banner, bonuses), leaves, holidays | `src/routes/hr.ts` | `pages/Stipends.tsx`, `pages/Leaves.tsx` |
| Streak engine (00:05 IST + catch-up), monthly calendars, milestones, adjustments | `src/lib/streakEngine.ts`, `src/routes/streaks.ts` | `pages/Streaks.tsx`, `components/StreakCalendar.tsx` |
| Training videos: server-side Drive embed, watermark, view logging & notifications | `src/routes/videos.ts` | `pages/Videos.tsx`, `pages/VideoPlayer.tsx` |
| Vault (AES-256-GCM at rest, per-item sharing, logged reveals, renewals, export) + directory | `src/routes/vault.ts`, `src/lib/crypto.ts` | `pages/Vault.tsx` |
| Notifications, announcements, audit log, global search, settings, dashboards | `src/routes/misc.ts` | `Layout.tsx`, `pages/Dashboard.tsx`, `pages/Activity.tsx`, … |
| Files (stored in PostgreSQL, 10 MB/file) | `src/routes/misc.ts` (`/api/files`) | `components/ui.tsx` (`FileUpload`) |

## Security model (summary)

- Every permission check is **server-side**: middleware + per-query subtree filters
  (`src/lib/org.ts`). Opening another branch's task/report/profile by direct URL returns **403**.
- Server-side sessions in the database (not stateless JWTs): a worker's second-device login
  instantly revokes the first with the message *"You were signed out because this account was
  signed in on another device."* The Primary Admin holds up to 5 sessions (configurable); a 6th
  bumps the oldest. Admin can force-logout anyone from the Sessions panel.
- Vault passwords are encrypted at rest (AES-256-GCM, key from `VAULT_ENCRYPTION_KEY`),
  masked by default, reveal-on-click, **every reveal logged** — which powers the offboarding
  rotation checklist.
- Video pages never contain the Drive URL or file id — playback goes through a server-rendered,
  token-guarded embed route with a live watermark of the viewer's name, and every play is logged
  and notified. **Honest note:** no web app can fully prevent screenshots/screen-recording;
  these are deterrents, and the UI says so. Set the Drive file itself to viewer-only with
  downloads disabled.
- Append-only audit log covers logins/kicks, task lifecycle, reports, queries, leaves, stipend
  marks, vault reveals/exports, video views, account & org changes. Nothing is ever hard-deleted;
  deactivated users stay queryable forever.

## Settings (Primary Admin → Settings)

EOD report time (default 20:00 IST) · whether the daily report counts toward streaks (default ON) ·
admin session limit (default 5) · heads-see-stipends (default OFF) · force password change on
first login (default OFF) · company name.
