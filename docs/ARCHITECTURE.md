# Bella Cucina — Restaurant Management System: Architecture & Reference

> **This document reflects the system as actually built and running today.**
> `IMPLEMENTATION_PLAN.md` in this same folder is an early planning draft
> (Firestore, branches, no licensing, admin/cashier-only) written before the
> real multi-tenant/licensing architecture existed — it does not match the
> current codebase and is kept only for historical context. Read this
> document instead.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Folder Structure](#3-folder-structure)
4. [Backend Workflow](#4-backend-workflow)
5. [Frontend Workflow](#5-frontend-workflow)
6. [Database Structure](#6-database-structure)
7. [Authentication & Authorization Flow](#7-authentication--authorization-flow)
8. [Licensing System](#8-licensing-system)
9. [User Roles & Permissions](#9-user-roles--permissions)
10. [API Endpoints](#10-api-endpoints)
11. [Environment Variables & Configuration](#11-environment-variables--configuration)
12. [Installation & Development Setup](#12-installation--development-setup)
13. [Build Process (Electron installers)](#13-build-process-electron-installers)
14. [Production Deployment](#14-production-deployment)
15. [Main Business Logic](#15-main-business-logic)
16. [Troubleshooting](#16-troubleshooting)
17. [Future Improvement Suggestions](#17-future-improvement-suggestions)

---

## 1. Project Overview

Bella Cucina is an **offline-first, multi-tenant restaurant management system**, packaged as a cross-platform desktop app (Electron) with a React frontend and a Node.js/Express backend. It supports full POS operations, inventory, staff, finance, delivery, loyalty, reporting, and a self-contained licensing system — all of it usable **fully offline**, syncing to a shared Postgres (Supabase) backend whenever internet is available.

It is **multi-tenant**: a single deployment serves many independent **Restaurants**, each with its own users, license, devices, and data, isolated from every other restaurant. A separate **Super Admin** layer manages restaurants and licenses across the whole system.

Every business record lives in a generic per-restaurant document store; every auth/licensing record (restaurants, users, licenses, devices, sessions, super admins) lives in dedicated, strongly-typed Postgres tables with a local-JSON offline mirror.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Electron Desktop App                          │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │  React SPA (Vite build)                                     │    │
│  │  Pages (lazy-loaded per route) · Zustand stores · i18n      │    │
│  │  axios client → same-origin /api/* (see below)              │    │
│  └───────────────────────────────┬───────────────────────────┘    │
│                                    │ served over http://localhost  │
│  ┌─────────────────────────────────▼──────────────────────────┐   │
│  │   electron/main.js — forks the SAME Express backend as a    │   │
│  │   child process (ELECTRON_RUN_AS_NODE), waits for its        │   │
│  │   /api/health to respond, then loads the window from it.     │   │
│  │   DATA_DIR points at Electron's per-user userData folder.    │   │
│  └───────────────────────────────┬──────────────────────────────┘  │
└────────────────────────────────────┼───────────────────────────────┘
                                      │ HTTP (same process tree, packaged)
                                      │  — or a separately-run `npm run dev`
                                      │    backend in local development
┌─────────────────────────────────────▼──────────────────────────────┐
│                    Node.js / Express Backend                        │
│  routes/ → services/ (business logic) → repositories/               │
│  middleware: auth (JWT) · requireDeviceBound · rbac · rate-limit     │
│                                                                      │
│  Two parallel persistence paths, chosen per-collection:              │
│                                                                      │
│  ┌─────────────────────────────┐   ┌────────────────────────────┐    │
│  │ Business data (repo())       │   │ Auth/licensing data          │    │
│  │ generic JSONB `records` table│   │ (secureStore())               │    │
│  │  OR local per-collection      │   │ dedicated typed Postgres     │    │
│  │  JSON files when offline      │   │ tables + local JSON mirror   │    │
│  └───────────────┬──────────────┘   └───────────────┬────────────┘    │
│                  │ outbox + sync engine (both paths) │                 │
└──────────────────┼────────────────────────────────────┼────────────────┘
                    │ when online                        │ when online
              ┌─────▼─────────────────────────────────────▼─────┐
              │              Supabase (Postgres)                  │
              │  records (JSONB) · restaurants · users · licenses │
              │  devices · login_sessions · super_admins          │
              └───────────────────────────────────────────────────┘
```

**Key architectural decisions**

- **Two-tier persistence.** Everyday business data (orders, clients, inventory, etc.) lives in one generic `records(collection, id, data)` JSONB table (or one local JSON file per collection when offline) — see `backend/src/repositories/`. Auth-critical data (restaurants, users, licenses, devices, sessions, super admins) lives in **real, strongly-typed Postgres tables** with their own local JSON mirror — see `backend/src/repositories/secureStore.js`. This split exists because auth data has NOT NULL/unique constraints and relational integrity that a schemaless JSONB blob can't enforce, while business data benefits from not needing a migration for every new field.
- **Offline-first by design, not as a fallback.** Every write goes to the local store first (instant, durable), then mirrors to Postgres immediately if reachable, or queues in an outbox if not. Reads prefer Postgres when online, local JSON when not. The user is never blocked on network latency for a write.
- **The backend is bundled INSIDE the desktop app.** In a packaged build, `electron/main.js` forks the exact same `backend/src/server.js` as a child Node process and waits for its health check before showing the window — there is no separate "install a server" step for an end user.
- **Multi-tenant from the ground up.** Every business collection is scoped by `restaurantId`; every service enforces that a caller can only read/write their own restaurant's rows (IDOR checks throughout).
- **Device-bound JWT + signed offline license.** A login binds the JWT to one specific device (fingerprint + a rotating secret) and mints a separately-signed (ECDSA P-256) "offline license" blob the client can verify without any network call, enabling long offline sessions while still being revocable.

---

## 3. Folder Structure

```
Restaurant-Management-System/
├── README.md                       # quick start
├── docs/
│   ├── ARCHITECTURE.md             # this document
│   └── IMPLEMENTATION_PLAN.md      # superseded early planning draft (historical)
├── architecture-report.html        # narrative walkthrough (open in a browser)
├── how-it-works.html               # narrative walkthrough (open in a browser)
│
├── backend/
│   ├── src/
│   │   ├── server.js               # Express app, middleware chain, boot sequence
│   │   ├── config/
│   │   │   ├── index.js            # env loading + all tunables (see §11)
│   │   │   ├── database.js         # Postgres pool + typed-table DDL (idempotent)
│   │   │   └── permissions.js      # role → permission matrix (single source of truth)
│   │   ├── models/index.js         # schema/validation for every business collection
│   │   ├── repositories/
│   │   │   ├── index.js            # repo(collection) factory — routes reads by connectivity
│   │   │   ├── localStore.js       # per-collection local JSON file store
│   │   │   ├── LocalJsonRepository.js / SupabaseRepository.js / BaseRepository.js
│   │   │   ├── supabaseRecords.js  # generic JSONB `records` table helpers
│   │   │   └── secureStore.js      # typed-table auth data (restaurants/users/licenses/devices/sessions)
│   │   ├── services/                # one file per business module (business logic lives here)
│   │   ├── routes/
│   │   │   ├── index.js            # all restaurant-facing routes (auth required)
│   │   │   ├── superAdmin.js       # super-admin-only routes
│   │   │   └── license.js          # license activation/status/devices (self-service)
│   │   ├── middleware/              # auth.js, rbac.js, validate.js, rateLimit.js, errorHandler.js
│   │   ├── sync/                    # connectivity.js, outbox.js, syncEngine.js
│   │   ├── sessions/sessionSweep.js # background idle-session cleanup
│   │   ├── migrations/runMigrations.js  # idempotent boot-time bootstrap (see §12)
│   │   ├── seed/                    # opt-in mock-data generator (`npm run seed`)
│   │   ├── utils/                   # pdf.js, excel.js, hash.js, lock.js, offlineLicenseCrypto.js, ...
│   │   └── data/                    # local JSON store (generated at runtime, gitignored content)
│   ├── fonts/                       # Arabic PDF font — must stay in electron-builder's extraResources filter
│   ├── .env.example
│   └── package.json
│
└── frontend/
    ├── electron/
    │   ├── main.js                 # forks the backend, health-checks it, opens the window
    │   └── preload.js              # contextBridge (print, save-file)
    ├── scripts/afterPack.cjs       # copies backend/node_modules into the packaged app
    ├── src/
    │   ├── main.jsx / App.jsx      # entry + router (HashRouter, route guards)
    │   ├── api/client.js           # axios instance, auth header injection, 401 handling
    │   ├── store/                  # zustand: auth.js, ui.js, connectivity.js, posStats.js
    │   ├── i18n/ (en.js, ar.js)    # flat-ish nested translation objects, full RTL support
    │   ├── layout/                 # AppShell, Sidebar, Topbar, OfflineBlock
    │   ├── components/ui.jsx       # shared design-system components (DataTable, Modal, Select, ...)
    │   ├── pages/                  # one file per module/route
    │   ├── hooks/                  # useApi.js, usePaginated.js
    │   └── utils/                  # format.js, fingerprint.js, offlineLicense.js
    ├── vite.config.js / vitest.config.js
    └── package.json                # electron-builder "build" config lives here
```

---

## 4. Backend Workflow

1. **Boot** (`server.js` → `start()`): loads env, mounts middleware and routes, then calls `runMigrations()` (idempotent — safe to run on every boot):
   - ensures at least one Super Admin exists (`superadmin` / `superadmin123` by default),
   - ensures a bootstrap restaurant + an already-activated ("forever") license exist,
   - ensures that bootstrap restaurant has at least one working login (`ensureDefaultAccounts` — creates `admin`/`admin123` and `cashier`/`cashier123` if that restaurant has zero users; silently skips whichever of those usernames is already taken elsewhere rather than ever crashing boot),
   - backfills a few historical-data migrations (restaurant_id stamping, city field, cash ledger seeding) — each guarded to run at most once.
   - Then starts the sync engine and the idle-session sweep, and starts listening on `PORT` (default 4000).
2. **Every request**: `auth` middleware verifies the JWT (`Authorization: Bearer`) → `req.user`. Restaurant-facing routes additionally run `requireDeviceBound`, which re-validates the device fingerprint, device secret, device revocation status, and session status on every single request — a session can be terminated or a device revoked and it takes effect on the very next request, not just the next login.
3. **Route → service → repository.** Routes are thin (`h(async (req,res) => res.json(await someService.doThing(req.body, req.user)))`); all business rules and tenant-isolation checks live in `services/`.
4. **Persistence routing**: `repo(collection)` and `secureStore()` both check `connectivity.isOnline` before every read to decide Postgres vs. local JSON; every write always goes local first, then mirrors to Postgres (immediately if online, via the outbox if not).
5. **Background loops**: `syncEngine` drains the outbox on an interval (and immediately on reconnect); `connectivity` re-probes Supabase reachability on a short interval while offline so the app snaps back online almost the instant real internet returns; `sessionSweep` releases abandoned session/device slots on an idle timeout.

---

## 5. Frontend Workflow

1. **Routing** (`App.jsx`, `HashRouter`): `/login`, `/superadmin/login` are public. Everything else is wrapped in a `Protected` route guard (redirects to login if no `user` in the auth store) and, for restaurant routes, an `ActivationGuard` + `AppShell`.
2. **Auth store** (`store/auth.js`, zustand): holds `user`, `token`, `offlineLicense`, `offlineStatus`. `login()` posts credentials + device fingerprint to `/auth/login`, stores the JWT + signed offline license in `localStorage`, and (for a first-ever login on a never-activated restaurant) surfaces `requiresActivation` so the UI can route to `LicenseActivation.jsx`.
3. **AppShell** (`layout/AppShell.jsx`): on every mount (and once a day thereafter regardless of connectivity transitions), re-evaluates the offline license via `evaluateOfflineAccess()`. If the tier is `'expired'`, the entire app is replaced by a blocking `OfflineBlock` screen until the device successfully reconnects and re-authenticates.
4. **API client** (`api/client.js`): attaches `Authorization`, `X-Device-Fingerprint`, `X-Device-Secret` headers to every request; a response interceptor flips the shared `connectivity` store's `online` flag based on whether requests are actually succeeding, and force-logs-out on a `401`.
5. **Pages** are lazily loaded per route (`React.lazy`) so the initial bundle doesn't ship all ~25 modules up front; `recharts`, `react`/`react-router`, and `i18next` are split into their own vendor chunks.
6. **i18n**: `react-i18next` with two parallel translation files (`en.js`, `ar.js`); the active language also flips the document's text direction for full RTL support in Arabic.

---

## 6. Database Structure

### Typed tables (via `secureStore`, `backend/src/config/database.js`)

| Table | Purpose | Notable columns |
|---|---|---|
| `restaurants` | One row per tenant | `restaurant_name`, `status` (active/suspended/deleted) |
| `users` | Real, login-capable accounts (Admin/Cashier) | `restaurant_id`, `username` (globally unique, case-insensitive), `password_hash`, `role`, `status` |
| `super_admins` | Cross-tenant administrators | `username`, `password_hash`, `status` |
| `licenses` | One per restaurant | `expiration_date`, `offline_days`, `maximum_devices`, `active_devices`, `validation_interval_hours`, `max_concurrent_cashier_sessions`, `session_timeout_minutes`, `status` |
| `devices` | One per registered device per user | `restaurant_id`, `user_id`, `fingerprint`, `device_secret_hash`, `last_online_validation_at`, `status` |
| `login_sessions` | One per issued JWT | `jwt_id`, `user_id`, `restaurant_id`, `device_id`, `status` (active/expired/logged_out/revoked), `last_seen_at` |

Usernames are **globally unique across every restaurant** (case-insensitive, enforced both in application code and a database unique index) — not just unique per-restaurant.

### Generic business data (via `repo()`, JSONB `records` table)

One `records(collection text, id text, data jsonb, ...)` row per document. Every collection below is additionally scoped by a `restaurantId` field inside `data` and filtered by every service:

`orders`, `products`, `goods`, `clients`, `workers`, `attendance`, `expenses`, `salaries`, `reservations`, `kdsTickets`, `shifts`, `locations`, `settings`, `suppliers`, `rents`, `cashAdvances`, `complaints`, `cashierShifts`, `cashLedger`, `purchases`, `goodsChecks`, `loyaltyTx`, `deliveryAgents`, `businessDays`.

Each record carries a `_sync` envelope used for offline/conflict handling:
```jsonc
"_sync": { "status": "pending|synced|conflict", "version": 7, "updatedAt": 1719400000, "deviceId": "pos-01", "deleted": false }
```

---

## 7. Authentication & Authorization Flow

1. **Login** (`POST /auth/login`): verifies username + password (bcrypt) against the `users` table, checks the restaurant isn't suspended/deleted, and validates the restaurant's license. Cashiers are hard-rejected from non-desktop User-Agents. On success: registers/reuses a `devices` row for this fingerprint (rotating its secret), creates a `login_sessions` row, signs a JWT (`{sub, restaurantId, role, deviceId, fingerprint, jti}`), and mints a signed offline license.
2. **Every subsequent request**: `auth` middleware verifies the JWT signature/expiry. `requireDeviceBound` (mounted on all restaurant routes) then re-checks, from the database, on every single call: device not revoked, device fingerprint still matches, device secret header matches, and the session is still `active` — so revoking a device or terminating a session takes effect immediately, not just on the next login.
3. **Offline license** (`utils/offlineLicenseCrypto.js`, ECDSA P-256): a JSON payload (`expirationDate`, `validatedAt`, `validationIntervalHours`, `offlineExpiration`, `monthlyValidationDeadline`, device fingerprint binding) is signed server-side and cached client-side. The frontend verifies the signature against the backend's public key and evaluates a tier (`ok` / `stale` / `expired` / `blocked`) purely offline — see §8.
4. **Super Admin login** (`POST /auth/login/superadmin`) is a separate, simpler flow with no device binding, used only for the Super Admin dashboard.
5. **Logout / heartbeat**: `POST /auth/logout` marks the session `logged_out`. `POST /auth/heartbeat` (called periodically while the app is open) keeps the session's `lastSeenAt` fresh (so the idle sweep doesn't release it) and returns a freshly-signed offline license.

---

## 8. Licensing System

Each restaurant has exactly one `licenses` row governing:
- **`expirationDate`** — the restaurant's actual subscription end date. Past this, no login succeeds at all (online or offline) until a Super Admin extends/renews it, or "Never Expire" is set.
- **`offlineDays`** — how many days a device may keep working after its last successful online validation before being forced to reconnect. **Merged with the license's own day count** (product decision) — it is set automatically to whatever `days` the license was created/renewed with (`createLicense`/`renewLicense` in `licenseService.js`) and is no longer an independently-configurable setting anywhere in the Super Admin UI or API.
- **`validationIntervalHours`** — the "rolling validation" window; past it (but still within `offlineDays`), the app requires reconnecting before continuing. Fixed at a 24-hour default for every restaurant — no longer independently configurable (removed from the Super Admin UI along with Session Timeout, below).
- **`maximumDevices` / `activeDevices`** — device-limit enforcement.
- **`maxConcurrentCashierSessions`** — how many cashiers may be logged in simultaneously.
- **`sessionTimeoutMinutes`** — idle-session release threshold, enforced by the background sweep. Fixed at a 30-minute default for every restaurant — no longer independently configurable.
- **Monthly online-validation deadline** — a *hard, non-configurable* backstop: both Admin and Cashier logins must complete a genuinely-online login or heartbeat at least once every 30 days, independent of the `offlineDays` setting. This deadline is anchored to the device's `last_online_validation_at`, which only advances on a contact the backend can confirm was genuinely online (`connectivity.isOnline` at that moment) — a login that only succeeded against locally-cached data while actually offline does **not** extend it, closing the loophole where a permanently offline device could keep "logging in" forever without ever truly reconnecting. Once the deadline passes, the app blocks with: *"Your license has expired. Please connect to the internet and activate your license to continue using the application."*
- Client-side, all of the above is defended against clock manipulation by a monotonic "high-water mark" timestamp (`frontend/src/utils/offlineLicense.js`) — winding the system clock backward can never make elapsed time appear smaller than it really was.

**Server-side enforcement (every request, not just login).** `requireActiveLicense` (`middleware/auth.js`) re-runs the exact same `licenseService.validateLicense()` check login uses, on every single restaurant-facing request — mounted right after `requireDeviceBound` on the blanket route group in `routes/index.js`, and explicitly on `/auth/heartbeat`. This closes what was previously a real gap: license validity used to be checked ONLY at login, so an already-authenticated session (valid JWT + device + session) could keep using every feature indefinitely — up to the JWT's full lifetime — after the license expired, was revoked, or was suspended, and calling the API directly (bypassing the frontend's own UI-level expiry screen entirely) was never blocked by anything. `GET /license/status`, `GET /license/my-devices`, etc. deliberately use `requireDeviceBound` alone (not `requireActiveLicense`) so an admin can still see *that* their license expired, not be locked out of the one screen that would tell them so.

**Server-side clock-rollback protection.** This backend runs embedded on the same machine as the user (see §2) — comparing a stored `expirationDate` against a plain `new Date()` is exactly as vulnerable to the user winding their OS clock backward as an unprotected frontend check would be. `utils/trustedTime.js` provides `getTrustedNow()`, a persisted (survives restarts, stored under `DATA_DIR`), monotonic high-water-mark analogous to the frontend's own clock guard — `licenseService.validateLicense()` uses it instead of `new Date()`. It's further hardened by `connectivity.check()`, which pulls Postgres's own clock (a timestamp the user does not control) on every successful reachability probe and feeds it in via `noteTrustedRemoteTime()`, so a genuinely-online moment can authoritatively advance the high-water mark past a clock that was rolled back while offline.

**Persisted offline-license signing key.** `utils/offlineLicenseCrypto.js` generates its ECDSA P-256 keypair once and persists it under `DATA_DIR`, rather than regenerating a purely ephemeral one on every process start. This matters specifically because packaged builds never have `OFFLINE_LICENSE_PRIVATE_KEY`/`PUBLIC_KEY` configured (no `.env` is bundled — see §13) — a purely ephemeral key used to invalidate every previously-issued offline license's signature on every single app restart (which happens on every close/reopen of this embedded-backend desktop app), and since the frontend's `evaluateOfflineAccess()` checks the signature *before* the expiration date, a signature failure reported tier `'blocked'` instead of the license's real `'expired'` status — and `'blocked'` is only enforced while offline, not online. In practice this meant an already-expired license could regain full dashboard access simply by restarting the app while online.

A Super Admin manages licenses via `superAdmin.js` routes: extend/reduce/renew, set-forever, revoke/suspend, adjust maximum devices or max concurrent cashier sessions, regenerate the activation token, force-logout all cashiers, or reset/revoke individual devices. Offline Days, Validation Interval, and Session Timeout are intentionally not exposed as separate controls — see above.

---

## 9. User Roles & Permissions

Three roles, defined once in `backend/src/config/permissions.js` and mirrored to the frontend via `/auth/me` so the UI can hide/disable what a role can't do:

| Role | Scope |
|---|---|
| **SUPER_ADMIN** | Cross-tenant: manage restaurants, licenses, devices, sessions. Never touches business data directly. |
| **ADMIN** (per restaurant) | Full access (`'*'`) to everything within their own restaurant. |
| **CASHIER** | Orders (create/read/print), clients (full CRUD), read-only inventory/delivery-agents/pending-payments (can mark paid), reservations (read/create), attendance (self), complaints, petty cash, rents (read), cash advances. Hard-blocked from settings, worker management, finance, reports. |
| **CHEF** | Read orders, view/advance KDS tickets, read-only inventory/products, attendance (self). |

Server-side enforcement is via the `rbac(...roles)` middleware on each route (never trust the client); the same matrix drives the frontend's `can()` helper for UI gating.

---

## 10. API Endpoints

Base URL: `/api`. Everything except `/auth/login*`, `/license/activate`, `/license/public-key`, and `/features` requires a valid JWT; restaurant-facing routes additionally require full device binding (see §7).

```
AUTH
  POST /auth/login                    POST /auth/login/superadmin
  POST /auth/logout                   POST /auth/heartbeat
  GET  /auth/me

LICENSE (self-service, restaurant Admin)
  POST /license/activate              GET  /license/status
  GET  /license/public-key            GET  /license/my-devices
  DELETE /license/my-devices/:deviceId

SUPER ADMIN
  Restaurants:  GET/POST/PUT /restaurants, /:id, PATCH /:id/suspend, DELETE /:id
  Users:        GET/POST /restaurants/:id/users, PATCH/DELETE /users/:userId,
                PATCH /users/:userId/suspend|activate
  Devices:      GET /restaurants/:id/devices, GET /users/:userId/devices,
                PATCH /devices/:deviceId/reset, DELETE /devices/:deviceId
  Sessions:     GET /sessions, GET /restaurants/:id/sessions[/active],
                PATCH /sessions/:sessionId/terminate,
                POST /restaurants/:id/force-logout-cashiers
  Licenses:     GET /licenses/:restaurantId,
                POST /licenses/:restaurantId/extend|reduce|renew|set-forever|regenerate-token,
                PATCH /licenses/:restaurantId/suspend|revoke|max-devices|max-concurrent-cashiers

RESTAURANT-FACING (all require auth + device binding)
  Workers:       /workers, /workers/:id, /workers/roster, /workers/cashiers,
                 /workers/:id/disable|reactivate, /workers/:id/activity
  Attendance:    /attendance/clock-in|clock-out|check|absences|overtime/bulk,
                 /attendance, /attendance/:id/excuse|overtime, reports/monthly
  Clients:       /clients (CRUD), /clients/search|filter|lookup, /clients/:id/history,
                 /clients/:id/phones|addresses
  Products:      /products (CRUD), /products/:id/cost
  Goods:         /goods (CRUD), /goods/:id/purchase, /goods/valuation, /goods/alerts/low-stock
  Goods Check:   /goods-checks, /goods-checks/reports/waste
  Orders:        /orders (CRUD), /orders/:id/cancel|status, /orders/:id/invoice.pdf,
                 /orders/pending-payments, /orders/:id/mark-paid, /orders/bulk-mark-paid
  Delivery:      /delivery-agents (CRUD)
  Cashier shifts:/cashier-shifts/open, /current[-all], /:id/close|reopen|analytics
  Finance:       /finance/income|expenses|profit|cashflow
  Analytics:     /analytics/dashboard|sales|inventory|workers|customers|locations
  Reports:       /reports, /reports/:type.pdf|.xlsx, /reports/bundle/:name.pdf|.xlsx
  Import:        /import/:entity[/validate]
  Reservations:  /reservations (CRUD), /reservations/calendar, /:id/no-show
  KDS:           /kds/tickets, /kds/tickets/:id/status
  Loyalty:       /loyalty/:clientId, /loyalty/:clientId/redeem
  Scheduling:    /shifts (CRUD), /shifts/forecast, /shifts/weekly
  Suppliers:     /suppliers (CRUD)
  Salaries:      /salaries, /salaries/preview, /salaries/generate|run, /:id/pay|adjust
  Cash advances: /cash-advances (CRUD), /pending/:workerId, /:id/withdraw|return
  Petty cash:    /petty-cash (CRUD)
  Rents:         /rents (CRUD), /rents/upcoming, /:id/pay|unpay
  Complaints:    /complaints (CRUD)
  Locations:     /locations (CRUD), /locations/tree
  Settings:      /settings (GET/PUT)
  Sync:          /sync/status, /sync/flush
  Features:      /features  (feature-flag summary, no device binding required)
```

---

## 11. Environment Variables & Configuration

All read in `backend/src/config/index.js` (see `backend/.env.example` for a ready-to-copy template):

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` tightens error-message verbosity |
| `PORT` | `4000` | Backend HTTP port |
| `JWT_SECRET` | `dev-secret-change-me` | **Must be set to a real secret in production** — see §16 |
| `JWT_EXPIRES_IN` / `JWT_EXPIRES_IN_HOURS` | `24h` / `24` | JWT lifetime |
| `ACTIVATION_TOKEN_ENCRYPTION_KEY` | falls back to `JWT_SECRET` | Dedicated 32-byte key for encrypting activation tokens — should be set and different from `JWT_SECRET` in production |
| `PERSISTENCE_MODE` | `auto` | `auto` = prefer Supabase, fall back to local JSON; `local` = always local JSON, ignore Supabase entirely |
| `DATABASE_URL` | — | Postgres connection string (self-hosted or hosted Supabase) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | — | Only needed if wiring Supabase Storage/Auth/Edge Functions directly (not required for the direct-Postgres repository path) |
| `SYNC_ENABLED` | `true` | Master switch for the sync engine |
| `SYNC_INTERVAL_MS` | `15000` | How often the outbox is drained while online |
| `SYNC_PROBE_TIMEOUT_MS` | `3000` | Timeout for a single connectivity probe |
| `SYNC_READ_TIMEOUT_MS` | `4000` | Timeout for a single sync read/write |
| `SYNC_OFFLINE_RETRY_MS` | `500` | How often connectivity is re-probed while offline |
| `SESSION_SWEEP_INTERVAL_MS` | `60000` | How often the idle-session sweep runs |
| `CONFLICT_POLICY` | `last-write-wins` | `last-write-wins` or `field-merge` — see the sync engine |
| `DATA_DIR` | `backend/src/data` | Where the local JSON store lives (Electron points this at its own per-user userData folder) |
| `OFFLINE_LICENSE_PRIVATE_KEY` / `OFFLINE_LICENSE_PUBLIC_KEY` | auto-generates an ephemeral keypair if unset/invalid | ECDSA P-256 PEM keys for signing offline licenses — **must** be set to a real, persistent keypair in production, or every restart invalidates every cached offline license |

---

## 12. Installation & Development Setup

**Prerequisites:** Node.js 18+.

```bash
# Terminal 1 — backend
cd backend
npm install                 # puppeteer's Chromium download is skipped (backend/.npmrc) — fast install
npm run dev                 # node --watch src/server.js → http://localhost:4000

# Terminal 2 — frontend
cd frontend
npm install
npm run dev                 # → http://localhost:5173
```

Open `http://localhost:5173`. On first boot, the backend automatically creates (idempotently, every boot):
- a Super Admin: `superadmin` / `superadmin123` (**change this in production**),
- a bootstrap restaurant with an already-active, non-expiring license,
- a default Admin (`admin` / `admin123`) and Cashier (`cashier` / `cashier123`) for that restaurant — unless those usernames are already taken by another restaurant on this database, in which case they're silently skipped (never crashes boot).

To create additional restaurants: sign in as Super Admin at `/#/superadmin/login` and use **Create Restaurant** — this generates the restaurant, its license, an activation token, and its first Admin account in one step.

**Reseed a large mock dataset (optional, local-JSON mode only):**
```bash
cd backend && npm run seed
```
Note this only populates the `workers`/`orders`/`clients`/etc. business collections for browsing/demoing — it does **not** create any login-capable `users` account (a Worker record is deliberately never login-capable; only the Super Admin flow or the bootstrap accounts above create real logins).

**Desktop app in dev:**
```bash
cd frontend
npm run electron:dev   # opens the Electron window against the separately-running dev backend/frontend
```

**Running tests:**
```bash
cd backend && npm test      # node:test, runs against an isolated temp local-JSON store
cd frontend && npm test     # vitest
```

---

## 13. Build Process (Electron installers)

```bash
cd frontend
npm run dist:linux   # → dist-installer/*.AppImage and *.deb
npm run dist:win     # → dist-installer/*.exe (NSIS installer)
```

Each command runs `vite build` first, then `electron-builder`, which:
1. Bundles the built frontend (`dist/`) and Electron shell files into the app package.
2. Copies the **backend source** (`src/**/*`, `fonts/**/*`, `package.json` — see `frontend/package.json`'s `extraResources` filter) into `resources/backend/`.
3. Runs `frontend/scripts/afterPack.cjs`, which copies `backend/node_modules` wholesale into `resources/backend/node_modules` (electron-builder's own dependency resolution doesn't apply to a resource that isn't this frontend package's own dependency graph).

**Prerequisites for `backend/node_modules` to exist before building:** run `npm install` in `backend/` at least once beforehand — the build does not do this for you.

**Known gotcha:** any backend runtime asset that lives outside `src/`, `fonts/`, or `package.json` (e.g. a `.env` file, another asset folder) is **not** bundled unless added to that `extraResources` filter — this exact class of bug already silently broke Arabic PDF rendering in packaged builds once (the `fonts/` folder was missing from the filter) before being fixed.

**Disk space:** each build temporarily unpacks a few hundred MB (`dist-installer/linux-unpacked` or `win-unpacked`) before compressing to the final artifact — clean these out between builds if disk space is tight:
```bash
rm -rf dist-installer/linux-unpacked dist-installer/win-unpacked dist-installer/builder-debug.yml
```

---

## 14. Production Deployment

- **Desktop (primary, current):** ship the built installer directly to end users; the backend runs embedded inside the Electron process, no separate server to host.
- **Centralized backend (optional, for a shared multi-device restaurant):** the same `backend/` can run standalone (`npm start`) behind a reverse proxy on a LAN server or a small VPS/container, with every device's Electron app (or a browser) pointed at it instead of forking its own local copy — this requires code changes to `electron/main.js` (skip `startBackend()`, point `loadURL` at the remote host) which are not currently wired up as a toggle.
- **Database:** self-hosted (via the Supabase CLI, `supabase start`) or a hosted Supabase project — either way, just a Postgres connection string in `DATABASE_URL`. The typed auth tables and the generic `records` table are created automatically and idempotently on first connect (`config/database.js`) — no manual migration step.
- **Secrets that matter in production:** `JWT_SECRET`, `ACTIVATION_TOKEN_ENCRYPTION_KEY`, and `OFFLINE_LICENSE_PRIVATE_KEY`/`OFFLINE_LICENSE_PUBLIC_KEY` must all be set to real, persistent values — see §16 for what happens if they're left at their dev defaults.

---

## 15. Main Business Logic

- **Orders (POS)**: `orderService.create()` prices every line server-side from the product's current price (never trusts a client-supplied price), validates quantities, deducts inventory per-ingredient under a lock (floored at zero, never negative), computes tax/discount/delivery fee, evaluates loyalty rewards, and records the sale in the Restaurant Cash Ledger if paid.
- **Cash Ledger vs. Cashier Shifts**: the Cash Ledger (`cashLedgerService`) is the single source of truth for the restaurant's overall cash balance; a Cashier Shift is a per-cashier till session (opening float → close/reconcile) that reads from the same ledger to compute expected cash.
- **Delivery & Pending Payments**: an order can be assigned a registered Delivery Agent with a payment timing (`PAID_NOW`, `END_OF_DAY`, `UNPAID_PRINTED`); anything not paid immediately shows up in Pending Payments until settled (individually or in bulk per agent).
- **Inventory**: ingredient quantities deduct automatically from product recipes on order completion; purchases restock and log an expense; a "goods check" reconciles physical counts against system quantities.
- **Loyalty**: points accrue on qualifying orders per configurable thresholds/rates in Settings, with an optional random bonus-points chance.
- **Payroll**: salary runs compute base pay, overtime, deductions (late arrivals, cash advances), and can be previewed before committing.
- **Reporting**: every major report (attendance, income/expenses/P&L, stock/waste, sales trends, customer activity, salary, worker performance) is generated server-side and exportable as PDF (`pdfkit`, with a bundled Arabic font) and Excel (`exceljs`).

---

## 16. Troubleshooting

**"Port 4000 is already in use"** — another instance (a previous `npm run dev`, or a packaged app that didn't shut down cleanly) is still bound to the port. Free it: `fuser -k 4000/tcp` (Linux) or find/kill the PID on Windows, or run on a different port: `PORT=4001 npm run dev`.

**Packaged app shows "The local backend service failed to start"** — as of this build, the error dialog itself includes the backend's actual recent output and will specifically call out a port conflict if that's the cause; check that detail text first before investigating further.

**A restaurant's admin/cashier login suddenly 401s on every request after working fine** — check that restaurant's `sessionTimeoutMinutes` on its `licenses` row directly (it's a fixed 30-minute default for every restaurant and no longer Super-Admin-editable, but a value left over from before that removal could still be short); a very short value logs out an idle session much sooner than expected.

**`npm run dev` crashes on boot with "This username is already taken by another restaurant's account"** — this specifically cannot happen anymore (fixed): the bootstrap default-account creation now skips gracefully and logs a warning instead of crashing if `admin`/`cashier` already belong to another restaurant on that database.

**Arabic text renders as boxes/garbled in a PDF from a packaged build** — verify `resources/backend/fonts/NotoSansArabic-Regular.ttf` actually exists in the packaged output; if not, check `frontend/package.json`'s `extraResources` filter includes `fonts/**/*` (see §13).

**Moving the project between machines/OSes** — `node_modules` bakes in platform-specific native binaries (esbuild, rollup, sharp, etc.). Delete `node_modules` in both `backend/` and `frontend/` and reinstall fresh on the target machine rather than copying the folder over.

**A device/session was revoked or terminated by a Super Admin, or the license expired, but the client still seems to work** — should not happen: every restaurant-facing route (including `POST /auth/heartbeat`) re-checks device/session validity (`requireDeviceBound`) AND the restaurant's license status/expiration (`requireActiveLicense`) on every single request, not just at login. If this is observed, it's a regression, not expected/known behavior — see §8 and §17's remaining limitations.

---

## 17. Future Improvement Suggestions

Concrete, verified gaps identified in the most recent full-codebase and licensing-security audits. Everything previously listed here from the general code audit (heartbeat device/session bypass, `JWT_SECRET` production warning, bulk-import NaN validation, client-stats race lock, goods-check validation/lock, attendance clock-in lock, reservation calendar date filter, frontend double-submit guards, Super Admin confirmation dialogs, and `/license/activate`/`/attendance/check` rate limiting) has been fixed — see the licensing-audit report for what changed most recently. What remains open:

1. **Local-file/local-database tampering while genuinely and permanently offline is not fully preventable.** This backend runs embedded on the same machine as the end user (see §2) — a user with filesystem access can directly edit the local license cache (e.g. `licenses.json`) to report a fake "active" status while the device has never reconnected to the real database. This is verified to be a real, exploitable gap **only while the backend has never regained genuine Postgres reachability since the edit** — the moment it does, `requireActiveLicense`/`validateLicense` read the authoritative remote copy instead (`secureStore` always prefers Postgres over the local cache when online), which the attacker cannot edit. Closing this fully would require a hardware trust anchor or a mandatory server round-trip on every check, either of which conflicts with the offline-first design goal. Mitigated in practice by: the monthly online-validation deadline (bounds how long an install can go without a genuine reconnect before hard-blocking regardless of local data), and the persisted-keypair fix (§8) ensuring the signed offline-license check the frontend relies on can't be sidestepped by restarting.
2. **Consider consolidating the repeated inclusive-date-range filtering logic** (seen with slight variations across `orderService`, `cashierShiftService`, `financeService`, `analyticsService`, `reservationService`) into one shared utility, to prevent the class of one-off off-by-one bug already found and fixed once.
3. **In-memory rate-limit buckets are never evicted** — acceptable for a single-process deployment but an unbounded, slow memory growth over long uptimes; add an eviction/expiry pass.
4. **A background sweep that proactively terminates sessions the moment a license naturally expires** (rather than only rejecting the *next* request from that session) would improve UX slightly — currently a session technically still "looks" logged in client-side until its next API call, even though that call is guaranteed to be rejected. Not a security gap (§8's `requireActiveLicense` already blocks every actual request), purely a nice-to-have.
