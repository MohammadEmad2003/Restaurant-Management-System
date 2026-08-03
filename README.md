# 🍽️ Bella Cucina — Restaurant Management System

A complete, **offline-first** restaurant management platform.
**React + Vite (+ Electron desktop)** · **Node.js + Express** · **Supabase (self-hosted Postgres)** · **Arabic + English (RTL/LTR)** · **PDF & Excel reporting**.

> **Runs immediately with mock data — no Supabase needed.** The backend boots on a local JSON store seeded with realistic data. Add your Supabase `DATABASE_URL` to `backend/.env` whenever you're ready and the sync engine pushes everything to Postgres automatically.

📐 The complete, up-to-date architecture & reference lives in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — read this for the real system (multi-tenant licensing, device-bound auth, API endpoints, deployment, troubleshooting).
🧭 A guided walkthrough of how the system actually fits together (storage model, roles, licensing, delivery payments, cash ledger) is in **[architecture-report.html](architecture-report.html)** — open it in a browser.

> `docs/IMPLEMENTATION_PLAN.md` is an early planning draft (Firestore, branches, no licensing) that predates the real architecture and does not reflect the current codebase — kept only for historical context.

---

## ✨ What's included (every feature, nothing skipped)

| Operations | Business | People | System |
|---|---|---|---|
| Dashboard & Analytics | Products (cost/profit) | Clients (CRM) | Multi-Branch |
| Orders / POS | Inventory + alerts | Loyalty program | Multi-tenant licensing |
| Kitchen Display (KDS) | Goods Check / Waste | Reservations + waitlist | Offline Sync engine |
| Delivery Agents & Pending Payments | Finance (P&L, cash flow) | Workers + salaries | Settings |
| Cash Drawer & Cash Ledger | Reports (PDF + Excel) | Attendance + overtime | Auth + RBAC |
| | Bulk Excel import | Employee Scheduling | AR/EN + RTL |

---

## 🚀 Quick start

**Prerequisites:** Node.js 18+.

> `node_modules` is platform-specific (native binaries for esbuild/rollup/sharp
> etc. differ per OS). If you ever copy this project between machines/OSes (e.g.
> Linux → Windows), delete `node_modules` in both `backend/` and `frontend/` and
> run `npm install` fresh on the target machine — a mismatched install is the
> most common cause of a dev server that won't start.

### 1) Backend (terminal 1)
```bash
cd backend
npm install         # puppeteer's Chromium download is skipped (see backend/.npmrc) — fast install
npm start           # → http://localhost:4000  (auto-creates a Super Admin + a bootstrap
                    #    restaurant with working admin/admin123 + cashier/cashier123 logins
                    #    on first run — see docs/ARCHITECTURE.md §12 for details)
```

### 2) Frontend (terminal 2)
```bash
cd frontend
npm install
npm run dev        # → http://localhost:5173
```

Open **http://localhost:5173** and sign in.

### First-time setup (multi-tenant / licensing)

The app is now organized around **Restaurants**, each with its own license and users.

1. **Super Admin** — go to **http://localhost:5173/#/superadmin/login** and sign in:
   | Role | Username | Password |
   |---|---|---|
   | 🛡️ Super Admin | `superadmin` | `superadmin123` |

2. From the Super Admin Dashboard, **create a Restaurant**. The system automatically creates the restaurant, its license, activation token, admin account, expiration date, offline period, and device limits.

3. Open **http://localhost:5173/#/login** and sign in with the restaurant admin credentials you just created. If the license is inactive, the Admin is prompted to enter the Activation Token.

4. **Cashiers** sign in at **http://localhost:5173/#/login** with their username and password only. The backend validates the restaurant license transparently on every cashier login.

> On a fresh install, the default Super Admin is created automatically. In production, change the default Super Admin password immediately.

### 3 ) Desktop app (optional, Electron)
```bash
cd frontend
npm run electron:dev   # opens the desktop window (dev)
npm run build && npm run electron   # production
```

### Reseed mock data anytime
```bash
cd backend && npm run seed
```

---

## 🔌 Connecting Supabase (optional)

Works with either a **self-hosted** instance (via the Supabase CLI) or a hosted
project — both just need a Postgres connection string.

**Self-hosted (local dev):**
1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and run `supabase start` in your Supabase project directory.
2. Copy the `DB URL` it prints (e.g. `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

**Hosted (supabase.com):**
1. Create a project at <https://supabase.com/dashboard>.
2. **Project settings → Database** → copy the connection string (use the pooled "Transaction" URL for production).

Then paste it into **`backend/.env`** (copy from `.env.example`):
```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
PERSISTENCE_MODE=auto
```

Restart the backend. The **Sync Status** page shows it go **Online** and flush pending changes to Postgres. Until then, everything keeps working offline — **no data is ever lost.** The `records` table (one JSONB row per document, matching the existing collection/document model) is created automatically on first connect — no manual migration needed.

---

## 🏗️ Project structure

```
Restaurant/
├── docs/ARCHITECTURE.md          # full architecture & reference (read this!)
├── backend/                      # Node.js + Express API
│   ├── src/
│   │   ├── config/  models/  repositories/  (local JSON + Supabase)
│   │   ├── services/  controllers via routes/  middleware/  (auth, rbac, rate-limit)
│   │   ├── sync/     (connectivity, outbox, conflict resolution)
│   │   ├── utils/    (pdf, excel, hash)   seed/  (mock data)
│   └── .env.example
└── frontend/                     # React + Vite + Electron
    ├── electron/                 # desktop shell
    └── src/
        ├── pages/                # one per module, lazy-loaded per route
        ├── components/  layout/  store/  i18n/ (ar+en)  styles/ (design system)
```

---

## 🧱 Tech & design

- **Single Frontend + Single Backend** — the previously separate Super Admin apps are merged into the same codebase. Separation is enforced by authentication, roles, route guards, layouts, and permissions.
- **Multi-tenant restaurant architecture** — every business record is scoped to a `restaurant_id`.
- **Restaurant licensing** — each restaurant has one license (activation token, expiration, device limits, offline days, rolling validation window). Admins activate/renew the license; cashiers are blocked when it expires.
- **Device-bound JWT** — every login registers the device and issues a JWT bound to user, restaurant, device, and fingerprint. Tokens are valid for 24 hours.
- **Offline-first repository pattern** — services depend on an interface; a factory swaps Supabase ↔ local JSON by connectivity.
- **Sync engine** — outbox queue, connectivity monitor, last-write-wins + field-merge + tombstones.
- **JWT auth + server-side RBAC** (`SUPER_ADMIN` / `ADMIN` / `CASHIER`) mirrored in the UI permission matrix.
- **Modern rounded design system** — soft shadows, generous radii, light/dark themes, violet brand, full RTL.
- **Reporting** — `pdfkit` + `exceljs`, every major report exportable as PDF & Excel.

---

## ⚡ Performance

The backend is offline-first: reads/writes hit a local JSON store first, and (when
Supabase is configured) an outbox queue mirrors changes to Postgres in the
background. A few things matter for keeping it fast as data grows:

- **Backend boot is lazy on heavy modules.** `pdfkit` and `exceljs` (report/invoice
  rendering, ~800 ms combined to load) are imported on first use, not at startup.
  `puppeteer` (optional, best-quality PDF rendering) is an `optionalDependency` and
  its Chromium download is skipped by default (`backend/.npmrc`); reports fall back
  to the built-in `pdfkit` renderer automatically if it isn't installed.
- **Local-store writes are async, coalesced and compact.** A burst of writes in the
  same tick (e.g. an order plus its cash-ledger entry) becomes one non-blocking file
  write per collection instead of several synchronous, pretty-printed ones. A flush
  also runs on process exit so nothing pending is lost. Tune the coalescing window
  with `STORE_FLUSH_MS` (default `30`ms).
- **The sync outbox only grows when something will actually drain it.** If Supabase
  isn't configured (the default), writes are never queued for a sync that can't
  happen — this was previously the single biggest source of write latency, since
  the queue grew forever and every write re-serialised it in full.
- **The frontend is code-split per route** (`React.lazy` + `Suspense`), with
  `recharts`, `react`/`react-router`, and `i18next` split into their own vendor
  chunks — the initial bundle no longer ships all 25 pages and the charting
  library up front.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full architecture reference,
including deployment, environment variables, and troubleshooting.

> **Moving this project between machines/OSes?** `node_modules` bakes in
> platform-specific native binaries. Reinstall (`rm -rf node_modules && npm install`)
> on the machine you're actually running on rather than copying the folder over —
> a Linux-built `node_modules` will not run Vite/esbuild on Windows (or vice versa).

---


## 📜 License
Provided as a starter/reference implementation. Use freely for your restaurant.

