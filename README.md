# 🍽️ Bella Cucina — Restaurant Management System

A complete, **offline-first** restaurant management platform.
**React + Vite (+ Electron desktop)** · **Node.js + Express** · **Firebase Firestore** · **Arabic + English (RTL/LTR)** · **PDF & Excel reporting**.

> **Runs immediately with mock data — no Firebase needed.** The backend boots on a local JSON store seeded with realistic data. Add your Firebase keys to `backend/.env` whenever you're ready and the sync engine pushes everything to the cloud automatically.

📐 The complete architecture & specification lives in **[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)** (all 15 deliverables, ERD, sequence diagrams, API, roadmap).

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

**Prerequisites:** Node.js 18+ (you have v24).

### 1) Backend (terminal 1)
```bash
cd backend
npm install
npm start          # → http://localhost:4000  (auto-seeds mock data on first run)
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

## 🔌 Connecting Firebase (optional)

1. Create a project at <https://console.firebase.google.com>.
2. **Project settings → General** → copy the web config values.
3. **Project settings → Service accounts → Generate new private key**.
4. Paste them all into **`backend/.env`** (copy from `.env.example`):
   ```env
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_CLIENT_EMAIL=...@your-project.iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   # ...and the rest
   PERSISTENCE_MODE=auto
   ```
5. Restart the backend. The **Sync Status** page shows it go **Online** and flush pending changes to Firestore. Until then, everything keeps working offline — **no data is ever lost.**

---

## 🏗️ Project structure

```
Restaurant/
├── docs/IMPLEMENTATION_PLAN.md   # full architecture & spec (read this!)
├── backend/                      # Node.js + Express API
│   ├── src/
│   │   ├── config/  models/  repositories/  (local JSON + Firestore)
│   │   ├── services/  controllers via routes/  middleware/  (auth, rbac, audit)
│   │   ├── sync/     (connectivity, outbox, conflict resolution)
│   │   ├── utils/    (pdf, excel, hash)   seed/  (mock data)
│   └── .env.example
└── frontend/                     # React + Vite + Electron
    ├── electron/                 # desktop shell
    └── src/
        ├── pages/                # one per module (18 pages)
        ├── components/  layout/  store/  i18n/ (ar+en)  styles/ (design system)
```

---

## 🧱 Tech & design

- **Offline-first repository pattern** — services depend on an interface; a factory swaps Firestore ↔ local JSON by connectivity.
- **Sync engine** — outbox queue, connectivity monitor, last-write-wins + field-merge + tombstones.
- **JWT auth + server-side RBAC** (admin / cashier) mirrored in the UI permission matrix.
- **Modern rounded design system** — soft shadows, generous radii, light/dark themes, violet brand, full RTL.
- **Reporting** — `pdfkit` + `exceljs`, every major report exportable as PDF & Excel.

---

## 📜 License
Provided as a starter/reference implementation. Use freely for your restaurant.
