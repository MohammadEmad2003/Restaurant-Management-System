# 🍽️ Bella Cucina — Restaurant Management System

A complete, **offline-first** restaurant management platform.
**React + Vite (+ Electron desktop)** · **Node.js + Express** · **Supabase (self-hosted Postgres)** · **Arabic + English (RTL/LTR)** · **PDF & Excel reporting**.

> **Runs immediately with mock data — no Supabase needed.** The backend boots on a local JSON store seeded with realistic data. Add your Supabase `DATABASE_URL` to `backend/.env` whenever you're ready and the sync engine pushes everything to Postgres automatically.

📐 The complete architecture & specification lives in **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)**.
🚀 A performance investigation & refactor (startup time, write latency, bundle size) is written up in **[REFACTOR_PLAN.md](REFACTOR_PLAN.md)**.

---

## ✨ What's included (every feature, nothing skipped)

| Operations | Business | People | System |
|---|---|---|---|
| Dashboard & Analytics | Products (cost/profit) | Clients (CRM) | Multi-Branch |
| Orders / POS | Inventory + alerts | Loyalty program | Audit Logs |
| Kitchen Display (KDS) | Goods Check / Waste | Reservations + waitlist | Offline Sync engine |
| | Finance (P&L, cash flow) | Workers + salaries | Settings |
| | Reports (PDF + Excel) | Attendance + overtime | Auth + RBAC |
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
npm start           # → http://localhost:4000  (auto-seeds mock data on first run)
```

### 2) Frontend (terminal 2)
```bash
cd frontend
npm install
npm run dev        # → http://localhost:5173
```

Open **http://localhost:5173** and sign in:

| Role | Username | Password |
|---|---|---|
| 👑 Admin (full access) | `admin` | `admin123` |
| 🧾 Cashier (POS + clients) | `cashier` | `cashier123` |

### 3) Desktop app (optional, Electron)
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
├── IMPLEMENTATION_PLAN.md        # full architecture & spec (read this!)
├── REFACTOR_PLAN.md              # performance investigation & fixes (read this too)
├── backend/                      # Node.js + Express API
│   ├── src/
│   │   ├── config/  models/  repositories/  (local JSON + Supabase)
│   │   ├── services/  controllers via routes/  middleware/  (auth, rbac, audit)
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

- **Offline-first repository pattern** — services depend on an interface; a factory swaps Supabase ↔ local JSON by connectivity.
- **Sync engine** — outbox queue, connectivity monitor, last-write-wins + field-merge + tombstones.
- **JWT auth + server-side RBAC** (admin / cashier) mirrored in the UI permission matrix.
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
  same tick (e.g. an order + its audit log) becomes one non-blocking file write per
  collection instead of several synchronous, pretty-printed ones. A flush also runs
  on process exit so nothing pending is lost. Tune the coalescing window with
  `STORE_FLUSH_MS` (default `30`ms).
- **The sync outbox only grows when something will actually drain it.** If Supabase
  isn't configured (the default), writes are never queued for a sync that can't
  happen — this was previously the single biggest source of write latency, since
  the queue grew forever and every write re-serialised it in full.
- **The audit log is capped locally** to the most recent `AUDIT_LOG_CAP` entries
  (default `2000`) so `/api/audit-logs` and every write stay bounded.
- **The frontend is code-split per route** (`React.lazy` + `Suspense`), with
  `recharts`, `react`/`react-router`, and `i18next` split into their own vendor
  chunks — the initial bundle no longer ships all 25 pages and the charting
  library up front.

See **[REFACTOR_PLAN.md](REFACTOR_PLAN.md)** for the full investigation, before/after
numbers, and follow-ups.

> **Moving this project between machines/OSes?** `node_modules` bakes in
> platform-specific native binaries. Reinstall (`rm -rf node_modules && npm install`)
> on the machine you're actually running on rather than copying the folder over —
> a Linux-built `node_modules` will not run Vite/esbuild on Windows (or vice versa).

---

## 📜 License
Provided as a starter/reference implementation. Use freely for your restaurant.

