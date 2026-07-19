# Performance Refactor — Findings, Changes & Results

_Investigation and refactor of the Bella Cucina restaurant management system to fix
startup latency and general UI/app "delay". Dated 2026-07-19._

## TL;DR

| Metric | Before | After |
|---|---|---|
| Backend module load (boot) | **~1,208 ms** | **~400 ms** (‑67%) |
| Sync outbox file | **243 KB, growing every write, forever** | **stays empty** (0 pending) |
| Per-write disk cost | synchronous, whole-collection, pretty-printed, **+ full outbox rewrite** | async, coalesced, compact, **no outbox rewrite** |
| Frontend initial bundle | monolithic — all 25 pages **+ recharts (422 KB)** loaded up front | split; recharts & each page load on demand |
| `frontend/node_modules` | **Linux** binaries (broken on Windows) | **Windows** binaries (`esbuild win32-x64`, `rollup win32-x64`) |
| Backend deps | 15 incl. 3 unused + mandatory Chromium (~150 MB) | 11 + `puppeteer` optional, Chromium download skipped |

All 22 backend tests and 30 frontend tests pass after the changes.

---

## Root causes found

### 1. 🔴 The sync outbox grew without bound (the dominant runtime delay)
Every `create`/`update`/`remove` appended a **full copy of the record** to
`backend/src/data/_outbox.json` (`LocalJsonRepository` → `outbox.enqueue`). That
queue is only drained by the sync engine, which **returns immediately when
Firebase isn't configured** (`syncEngine.flush`). The default setup has no
Firebase, so the outbox **never drained** — it had already reached **243 KB** and
every single write re-serialised and rewrote the whole file synchronously. Because
most actions also write an audit log, writes paid this cost twice. This is what
made the app feel progressively slower the more it was used.

### 2. 🔴 Synchronous, whole-file, pretty-printed writes on every mutation
`localStore.persist()` did `JSON.stringify(rows, null, 2)` + `fsync` rename for
the **entire collection on every write**, on the event loop. `orders.json` is
208 KB, so every new order re-serialised 208 KB and blocked the server.

### 3. 🔴 Wrong-platform `node_modules` (broke Vite/esbuild on Windows)
Both `frontend/node_modules` and `backend/node_modules` had been installed on
Linux — they contained Linux-only native binaries (`@esbuild/linux-x64`,
`rollup-linux-x64-gnu`, `@napi-rs/canvas-linux-x64`). On the Windows dev machine
these can't execute, which stalls/breaks the dev server and build.

### 4. 🟠 Heavy modules loaded on the boot path
`routes/index.js` eagerly imported every service, which pulled in `pdfkit`
(+ fontkit, 320 ms) and `exceljs` (492 ms) at startup — ~810 ms of the boot cost —
even though reports are an occasional, admin-only feature.

### 5. 🟠 `puppeteer` was a hard dependency
`puppeteer` downloads a ~150 MB Chromium on `npm install`, making the *install*
feel like a slow "startup". It's only ever an optional, best-quality PDF renderer
and was already dynamically imported with a `pdfkit` fallback.

### 6. 🟠 Unbounded audit log + eager frontend routing
`auditLogs` grew forever (the `/audit-logs` route loads *all* rows, filters and
sorts in JS). `App.jsx` imported all 25 pages statically, so nothing was
code-split.

### 7. 🟡 Repo hygiene
`.gitignore` had been deleted; 7 stray `test-*.js` scratch scripts sat in
`backend/`; the runtime data dir was at risk of being committed.

---

## Changes made

| # | Area | Change | File(s) |
|---|---|---|---|
| 1 | Outbox | `enqueue` is a **no-op unless a Firestore target can actually drain it** (`persistenceMode !== 'local' && isFirebaseConfigured()`). Stops unbounded growth in the default setup while preserving offline queueing when Firebase *is* configured. | `backend/src/sync/outbox.js` |
| 2 | Persistence | Rewrote `LocalStore`: cache stays the synchronous source of truth; disk writes are **coalesced + async** (a burst of writes = one file write), **compact** (no pretty-print), serialized per-collection, with a **synchronous flush on `exit`/`SIGINT`/`SIGTERM`** for durability. | `backend/src/repositories/localStore.js` |
| 3 | Audit | Roll the local `auditLogs` to the most recent `AUDIT_LOG_CAP` (default 2000) entries, trimmed on an amortised high-water mark. | `backend/src/middleware/audit.js` |
| 4 | Boot | Lazy-load `pdfkit`/`exceljs`/`htmlReport` **on first report/invoice/import request** instead of at boot. | `services/reportService.js`, `services/importService.js`, `routes/index.js` |
| 5 | Deps | Removed unused `arabic-persian-reshaper`, `bidi-js`, `pdf-parse`; moved `puppeteer` to `optionalDependencies`; added `backend/.npmrc` with `puppeteer_skip_download=true`. | `backend/package.json`, `backend/.npmrc` |
| 6 | Frontend | All route pages converted to `React.lazy` + a `<Suspense>` fallback; vite `manualChunks` splits `react`, `recharts`, `i18next` into long-cached vendor chunks. | `frontend/src/App.jsx`, `frontend/vite.config.js` |
| 7 | Hygiene | Restored `.gitignore` (+ `backend/test-*.js`), deleted the 7 stray scripts, reset the 243 KB outbox to `[]`. | `.gitignore`, data |
| 8 | Platform | Clean `npm install` of both `backend` and `frontend` on Windows. | — |

### Tunables introduced (env vars, all optional)
- `STORE_FLUSH_MS` (default 30) — write-coalescing window for the local store.
- `AUDIT_LOG_CAP` (default 2000) — rolling audit-log window kept locally.

---

## Verification performed
- Backend boots and serves `/api/health`; module load ~400 ms (was ~1,208 ms).
- End-to-end write test: creating a client succeeds, `sync.pending` stays **0**,
  `_outbox.json` stays `[]`, and the record is flushed to disk.
- `npm run build` (frontend) succeeds on Windows in ~14 s; recharts is emitted as a
  separate `vendor-charts` chunk (not in the initial payload).
- `npm test`: **backend 22/22**, **frontend 30/30** passing.

---

## Recommended follow-ups (not done here)
These are lower-risk-to-defer and/or need product decisions:

1. **`multer@1.x` → `2.x`** — 1.x has published vulnerabilities; 2.x has minor API changes worth testing.
2. **`recharts@2` → `3`** — v2 is EOL; migration guide applies.
3. **Firestore audit retention** — the local cap doesn't prune Firestore; add a TTL/retention policy there if cloud sync is used heavily.
4. **Storage engine** — the JSON store is fine for a single restaurant, but if volumes grow, `better-sqlite3` would give indexed queries and cheaper partial writes without changing the repository interface.
5. **Sync engine tests** — the outbox/conflict-resolution paths have no automated coverage.
6. **HTTP graceful shutdown** — the store now flushes on signals; consider also `server.close()` to drain in-flight requests.
