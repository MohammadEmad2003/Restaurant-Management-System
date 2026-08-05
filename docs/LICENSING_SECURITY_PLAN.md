# Licensing & Activation — Security Refactor Plan

Status: **implemented** (Phases 1, 2, 4, and the trusted-time portion of Phase
3 — see "What actually shipped" below). Deployed to the live central server
(`restaurant-backend.service`, `IS_LICENSE_AUTHORITY=true`) and built into
the Windows installer.
Scope: activation tokens, license expiry, device binding, clock-tamper resistance, online/offline behaviour.

## What actually shipped

| Phase | Planned | Shipped |
|---|---|---|
| 1 — License Authority | New server, moves signing key server-side, app stops being a DB client for everything | **Narrower and safer**: the existing centrally-hosted backend (already running at `bellacucina.duckdns.org` — §14 of ARCHITECTURE.md's "centralized backend" mode) took on the Authority role via `IS_LICENSE_AUTHORITY=true`. Activation and hardware binding proxy to it over HTTPS with no local fallback (`services/licenseAuthorityClient.js`). Business-data sync (`DATABASE_URL` for `records`/`devices`/`sessions`) is **unchanged** — see "Deliberately not done" below. |
| 2 — Token lifecycle | Hashed, TTL, single-use, hardware-bound | **Done as planned.** `activation_tokens` table, SHA-256 hash at rest, 72h default TTL, atomic single-use redemption (`licenseService.redeemActivationToken`). |
| 3 — Time integrity | 4 layers (sealed anchor, uptime cross-check, OS witnesses, server-time-as-ground-truth) | **Partial.** Routed every expiry-minting call site through `getTrustedNow()` (closes the "activate offline-forward, wind clock back" exploit structurally — the only code path that mints `licenses.expirationDate` now requires reaching the Authority). Layers 2–3 (uptime cross-check, OS event-log witnesses) were **not** built — see below. |
| 4 — Hardware binding | SMBIOS identity, k-of-n fuzzy match, header never trusted | **Done, exact-match per your decision.** Collected in Electron's main process (PowerShell/WMI: board serial, SMBIOS UUID, disk serial, CPU ID), bound per-device at first contact, re-verified every online heartbeat. Any mismatch flags `pending_reset` and locally suspends the license — no auto re-bind. |
| 5 — Local state encryption | Encrypt+HMAC `DATA_DIR` | **Not done** — see below. |

### Deliberately not done, and why

- **Business-data DB credentials still ship in the installer.** `DATABASE_URL` remains in `.env.electron` for the existing offline-first sync of orders/products/etc. Moving that off-device too is a much larger rewrite (`secureStore.js`/`repositories/index.js`/`syncEngine.js` would all need to become HTTP clients instead of direct Postgres clients) and was out of scope for a licensing-focused pass. Tracked as ARCHITECTURE.md §17 item 1.
- **Offline-license signing key stays on-device.** The plan's original Phase 1 called for moving ECDSA signing server-side entirely. That turned out to conflict with a hard requirement: this app's offline-first design means a cashier logs in with **zero internet**, which requires the JWT and the offline-license signature to be mintable locally. Moving signing off-device would have meant either breaking offline login or sharing JWT_SECRET between every install and the Authority (reintroducing a forgery risk). Kept as-is: each install (Authority and every desktop) persists its own keypair under `DATA_DIR`, unchanged from before this work.
- **Uptime cross-check / OS event-log witnesses (Layer 2–3) were not built.** These specifically defend against wind-the-clock-BACKWARD-after-activating attacks on an install that stays permanently offline. Given hardware binding now makes cloning an activated install to another machine require Super Admin approval, and activation/re-validation both require reaching the Authority (which uses ITS OWN clock, not the user's), the highest-value clock exploit — minting a fake future expiration — is closed structurally. The remaining exposure (a permanently-offline install winding its clock back to stay inside an already-granted offline window) is bounded by the existing monthly online-validation deadline, unchanged from before this work.
- **Local state encryption (Phase 5)** — not done; same local-tampering-while-permanently-offline caveat as before this work, documented in ARCHITECTURE.md §17.

## Decisions taken

| Question | Decision |
|---|---|
| Phase 1 (license authority) | **Build it.** Full trust boundary, not mitigations-in-place. |
| Hardware-change policy | **Super-admin approval.** Any hardware change requires a manually issued token. |

Consequences of the hardware-change decision, carried into §3.4 below:
- No k-of-n fuzzy matching. Hardware identity is exact — any component change
  triggers re-activation.
- This makes false-positive lockouts (replaced disk, RAM upgrade changing a
  reported serial, firmware update rewriting SMBIOS) a **support-load problem, not
  a security one**. The design must therefore make the super-admin re-issue path
  fast and the lockout message unambiguous about what happened, or every disk
  swap becomes a support ticket that reads like a bug.
- Requires a Super Admin UI affordance: "device hardware changed — issue
  replacement token", showing which components differ, so the operator can
  distinguish a legitimate repair from an attempted clone.

Still open: re-validation window length, VM policy, authority HA (§7).

---

## 0. The one thing that decides everything else

The desktop app is currently a **direct PostgreSQL client**. `resources/backend/.env`
ships inside the installer with:

| Secret | What it unlocks |
|---|---|
| `DATABASE_URL` | Read/write access to the production database for **every restaurant** |
| `JWT_SECRET` | Forge an auth token for any user, any role, any restaurant |
| `ACTIVATION_TOKEN_ENCRYPTION_KEY` | Decrypt every stored activation token in the system |

Anyone who installs the app can extract these in under a minute (the file is plain
text inside the NSIS payload). With `DATABASE_URL` alone the entire licensing
system is bypassable with one SQL statement:

```sql
update licenses set status='active', expiration_date='9999-12-31T23:59:59.999Z';
```

**No amount of clock-tamper defence matters while this is true.** Hardening the
time logic while the database password ships to the customer is putting a
deadbolt on a door with no wall around it. So Phase 1 below is not optional
polish — it is the precondition that makes Phases 2–5 meaningful.

Everything in this plan is ordered by that reality: establish a trust boundary
first, then make the licensing logic correct within it.

---

## 1. Findings — current state

Verified by reading the code, not inferred.

### 1.1 Secrets and trust boundary

| # | Finding | Location |
|---|---|---|
| A1 | Production DB credentials, JWT secret, and token encryption key ship inside the installer | `frontend/package.json` `extraResources` → `resources/backend/.env` |
| A2 | Client is a direct DB client — no server-side authority validates anything | `backend/src/repositories/secureStore.js` |
| A3 | The offline-license **private signing key** is generated and stored on the end-user machine in plaintext | `backend/src/utils/offlineLicenseCrypto.js:37-64` → `DATA_DIR/.offline-license-key.json` |

A3 deserves emphasis. The offline-license scheme signs a payload with ECDSA
P-256 and the frontend verifies it. But **both** keys live on the same machine
the user controls. The user can sign their own payload with any
`expirationDate` they like. The signature check in
`frontend/src/utils/offlineLicense.js:49` is, against a motivated user,
decorative.

### 1.2 Local state is unprotected

| # | Finding | Location |
|---|---|---|
| B1 | `licenses.json`, `devices.json` written as **plaintext, unsigned JSON** | `backend/src/repositories/localStore.js:69,90` |
| B2 | Clock high-water mark is a plaintext file — delete it and rollback protection resets | `backend/src/utils/trustedTime.js:28` → `.trusted-time-hwm.json` |
| B3 | Client-side high-water mark lives in `localStorage` — "clear browsing data" resets it | `frontend/src/utils/offlineLicense.js:5,20-22` |

Editing `%APPDATA%/Bella Cucina RMS/backend-data/licenses.json` and setting
`expirationDate` to a far-future date grants unlimited offline use. No integrity
check would notice.

### 1.3 Clock trust is inconsistent

`getTrustedNow()` exists and is well-designed — but it is called in **exactly one
place** in the entire backend:

```
backend/src/services/licenseService.js:225   ← the only consumer
```

Every path that *mints* a deadline uses the raw, user-settable local clock:

| # | Finding | Location |
|---|---|---|
| C1 | `licenseExpirationDate()` computes expiry from `new Date()` | `licenseService.js:44` |
| C2 | Login expiry check uses `new Date()` | `authService.js:98` |
| C3 | `generateOfflineLicense` sets `validatedAt` / `offlineExpiration` from `new Date()` | `authService.js:363-365` |
| C4 | `computeMonthlyValidationDeadline` uses `Date.now()` | `authService.js:358` |
| C5 | `lastOnlineValidationAt` — the anchor the monthly requirement is measured from — set from `new Date()` | `deviceService.js:64-66,127-128` |

**The concrete exploit today:** set the system clock forward to 2035, activate
(activation *does* require connectivity, and that check works), and
`licenseExpirationDate()` writes a 2035 expiry straight into Postgres. Set the
clock back. The license is now valid for a decade, and the high-water mark
defence never engages because the value it is protecting was poisoned at the
moment it was created.

### 1.4 Device binding is weak

| # | Finding | Location |
|---|---|---|
| D1 | Fingerprint = `btoa(userAgent \| language \| screen \| cores \| timezone)` — no hardware component | `frontend/src/utils/fingerprint.js:6-15` |
| D2 | Backend trusts the `x-device-fingerprint` header verbatim | `backend/src/utils/device.js:4-6` |
| D3 | Fingerprint is cached in `localStorage` and replayable | `frontend/src/api/client.js:12` |
| D4 | Timezone is a fingerprint input — changing the clock's timezone changes device identity | `fingerprint.js:12` |

D4 collides directly with your requirement. If we harden against clock changes
while timezone remains a fingerprint input, a user who legitimately travels or
fixes their timezone gets locked out of their own device.

### 1.5 Activation-online enforcement

The online-only check **does work** — `isSupabaseConfigured()` returns true
because `DATABASE_URL` is set, so `authService.js:272-277` genuinely probes
Postgres before allowing activation.

| # | Finding | Location |
|---|---|---|
| E1 | "Online" means *reachable Postgres* — a hosts-file entry pointing `bellacucina.duckdns.org` at the user's own Postgres satisfies it | `sync/connectivity.js:32-56` |
| E2 | Activation tokens have **no expiry of their own** — valid forever until used or regenerated | `licenseService.js:40-42` |
| E3 | Tokens are not single-use — the same token re-activates repeatedly, each time granting a fresh 30-day window | `licenseService.js:129-139` |

E2 and E3 are exactly what you asked to fix.

---

## 2. What you asked for, and what is actually achievable

You asked to tie expiry to the motherboard clock. Being straight with you about
the hardware reality, because it changes the design:

**There is no tamper-proof clock readable from user space.** The motherboard RTC
is what the OS clock is *derived from*, and it is settable from BIOS/UEFI. A
"read the hardware clock instead of the OS clock" approach buys nothing — the
user can change both, and changing the RTC is if anything easier.

What genuinely works, and what I propose instead:

| Your requirement | Mechanism that actually delivers it |
|---|---|
| Token expires after a set time | Server-issued token with `issuedAt`/`expiresAt`, single-use, enforced server-side |
| Activation online only | Activation moves to a server endpoint — offline activation becomes structurally impossible, not policy-blocked |
| Auth works offline afterwards | Server-signed offline grant, verified with a **public key only** on the client |
| User can't gain time by changing the clock | Sealed monotonic anchor + boot-uptime cross-check + independent OS time witnesses |
| Tie to the motherboard | SMBIOS baseboard serial + system UUID as **hardware identity** (binding, not timing) |

The motherboard's real contribution is **identity**, not time — it stops a
licensed install being cloned to another machine. Time integrity comes from a
different mechanism, described in §3.3.

---

## 3. Target design

### 3.1 Trust boundary (Phase 1)

Introduce a **license authority** service on your existing server
(`bellacucina.duckdns.org`), exposed over HTTPS. The desktop app never touches
Postgres directly again.

```
Desktop app                    License Authority               Postgres
-----------                    -----------------               --------
POST /activate       ───────►  verify token, bind HW    ─────►  licenses
  {token, hwId}                sign grant (server key)
                     ◄───────  {grant, signature, serverTime}
                                        │
                              private key NEVER leaves here
```

Concretely:
- Desktop `.env` keeps **no** `DATABASE_URL`, **no** `JWT_SECRET`, **no**
  `ACTIVATION_TOKEN_ENCRYPTION_KEY`. It ships one thing: the authority's
  **public** key, which is safe to publish.
- The offline-license signing keypair moves server-side. `offlineLicenseCrypto.js`
  keeps only `getPublicKeySpkiBase64()` and verification; `signOfflinePayload()`
  is deleted from the client build. This closes A3.
- Rotate every credential currently in `.env.electron` — treat all three as
  compromised, because they have shipped.

This is the largest piece of work and I'd scope it as its own milestone. The
remaining phases assume it.

### 3.2 Token lifecycle (Phase 2)

Replace the current forever-valid, infinitely-reusable token.

New `licenses` / `activation_tokens` fields:

```
token_hash          -- Argon2id/scrypt hash, NOT reversible encryption
issued_at           -- server clock
expires_at          -- server clock + configurable TTL (default 72h)
consumed_at         -- set on first successful activation; non-null = dead
bound_hardware_id   -- set on activation, immutable thereafter
issued_by           -- super admin audit trail
```

Behaviour changes:
- **Hashed, not encrypted.** The current design encrypts the token so the super
  admin can read it back (`getActivationToken`). That means a key exists that
  reverses every token in the database. Store a hash; show the plaintext exactly
  once at generation time. Removes the entire class of bug you hit today.
- **TTL.** Token dies at `expires_at` whether used or not.
- **Single use.** `consumed_at` set atomically inside a transaction (`update ...
  where consumed_at is null returning *`) so two concurrent activations can't
  both win.
- **Hardware bound.** After activation the token is welded to one machine.
- **Re-activation** requires the super admin to issue a fresh token. This is the
  correct control point — it is where your revenue decision lives.

### 3.3 Time integrity (Phase 3)

Four independent layers. Each is individually defeatable; together they make
clock manipulation expensive and, crucially, **detectable**.

**Layer 1 — Sealed monotonic anchor.** Keep the existing high-water-mark idea but
make it tamper-evident: store it inside a record signed by the server's key at
the last online contact, encrypted at rest with a key derived from the hardware
ID. Deleting the file is then not a reset — a missing anchor becomes a *hard
failure* requiring reconnection, not a free pass. This closes B2/B3.

**Layer 2 — Boot-uptime cross-check.** Within a single boot, `os.uptime()` is
monotonic and not user-settable. Persist `(bootId, uptimeSeconds, wallClock)` on
every check. If wall clock moved backward while uptime moved forward, the user
**provably** changed the clock — there is no innocent explanation. Record it as a
tamper event; N events, or any single backward jump beyond a tolerance, forces
online re-validation.

**Layer 3 — Independent OS time witnesses.** Sample the newest mtime across
sources the OS writes continuously and the user would have to tamper with far
more broadly to fake:

- Windows event logs (`C:\Windows\System32\winevt\Logs\*.evtx`)
- Prefetch directory entries
- `Win32_OperatingSystem.LastBootUpTime` via WMI

The maximum observed becomes a **lower bound on real time**. A user who winds the
clock back but keeps using Windows generates fresh log writes that contradict
their own clock.

**Layer 4 — Server time is ground truth.** Every online contact takes
`serverTime` from a **signed** response (not `select now()` against a database
the user could substitute — this closes E1). It authoritatively advances the
anchor and resets the offline grace window.

Then, the mechanical part: **route every deadline through the trusted clock.**
Introduce `trustedTime.getTrustedNow()` as the *only* clock any licensing code
may read, and fix C1–C5 — currently five of six paths bypass it. Add an ESLint
rule banning `Date.now()` / `new Date()` inside `services/licenseService.js`,
`services/authService.js`, `services/deviceService.js` so this cannot regress.

### 3.4 Hardware binding (Phase 4)

Replace the browser-characteristics fingerprint with a real hardware ID,
collected in the Electron **main** process (not the renderer, where it would be
spoofable) and exposed over the existing `contextBridge`.

Windows, via WMI / `wmic` / PowerShell CIM:

```
Win32_BaseBoard.SerialNumber           -- motherboard serial   ← "the motherboard"
Win32_ComputerSystemProduct.UUID       -- SMBIOS system UUID
Win32_DiskDrive.SerialNumber           -- primary disk
Win32_Processor.ProcessorId            -- CPU ID
```

Design details that matter:
- **Exact matching** (per the decision above). Hash each component separately and
  store all of them; any mismatch fails closed and requires a super-admin-issued
  replacement token.
- Because matching is exact, the **diagnostics** carry the weight that fuzzy
  matching would otherwise have carried. On mismatch, record *which* components
  changed and surface that to both the user ("this appears to be different
  hardware") and the Super Admin console (component-level diff). Without this,
  a routine disk replacement is indistinguishable from a cloning attempt, and
  neither the customer nor the operator can tell what to do next.
- **Drop timezone from the fingerprint** (D4), so timezone changes stop causing
  spurious device mismatches.
- **Never trust the header.** The hardware ID is a claim; the server binds it at
  activation and compares thereafter. `buildFingerprint()` must stop returning
  `req.headers['x-device-fingerprint']` unconditionally (D2).
- Virtualised environments return null/duplicate serials. Detect and either
  refuse activation or flag for manual review — otherwise VMs become a trivial
  cloning path.

### 3.5 Tamper-evident local state (Phase 5)

- Encrypt `DATA_DIR` license/device state with a key derived from the hardware ID
  (`scrypt(hardwareId, installSalt)`), so copying the folder to another machine
  yields garbage.
- HMAC every record; a signature mismatch is a tamper event, not a silent
  fallback to defaults.
- Distinguish *corrupt* (readable failure → require reconnection) from *absent*
  (first run → normal activation flow). Today both quietly degrade to permissive
  behaviour.

---

## 4. Resulting behaviour

**Activation** — online only, structurally. The token is redeemed against a
server the user doesn't control; there is no local code path that can mark a
license active. Server binds hardware, records its own time, returns a signed
grant.

**Normal offline operation** — unchanged for the user. Login validates against the
signed grant using the public key. Works indefinitely offline up to the grant's
window.

**Rolling re-validation** — each online heartbeat refreshes the grant and advances
the anchor. Unchanged in shape from today; the difference is the signature is now
one the user cannot produce.

**Clock manipulation** — backward jumps are detected via uptime cross-check and OS
witnesses, and cost the user access rather than granting it. Forward jumps no
longer poison stored expiry, because expiry is minted server-side.

**Grace period ends** — hard requirement to reconnect. Same UX as today's
`'stale'` / `'expired'` tiers, which are already built and tested.

---

## 5. Phasing

| Phase | Work | Risk | Depends on |
|---|---|---|---|
| **0** | Rotate all three shipped secrets; stop bundling `.env`; short-term: restrict the DB role to least privilege | Low | — |
| **1** | License authority service; move signing keypair server-side; app stops being a DB client | **High** — architectural | 0 |
| **2** | Token TTL, single-use, hashed-not-encrypted, hardware-bound | Medium | 1 |
| **3** | Route all deadlines through trusted clock (C1–C5); sealed anchor; uptime cross-check; OS witnesses | Medium | 1 |
| **4** | SMBIOS hardware binding with k-of-n matching; drop timezone | Medium | 1 |
| **5** | Encrypt + HMAC local state | Low | 4 |
| **6** | Test matrix, migration for existing installs, staged rollout | Medium | all |

Phase 0 is worth doing this week regardless of whether the rest proceeds.

### Migration

Existing activated installs must not break. Plan: ship the new client able to
verify **both** the old locally-signed grant and the new server-signed grant, with
the old path accepted for one release cycle and a forced re-activation prompt on
next online contact. Without this, every current customer is locked out on
upgrade day.

### Test matrix

Each gets an automated test — the existing suite already has good coverage of the
offline tiers (`frontend/src/utils/offlineLicense.test.js`) to extend:

- Clock back 1 day / 1 year, online and offline
- Clock forward then back (the current C1 exploit — must fail after the fix)
- `DATA_DIR` deleted / edited / copied to another machine
- HWM file deleted
- Token replay, expired token, token on second machine
- Disk swap (must still work — k-of-n), motherboard swap (must fail)
- Activation with hosts-file redirect to attacker Postgres (must fail after Phase 1)
- Offline across the grace boundary; VM detection

---

## 6. Honest limits

The app runs on hardware the user controls, so a sufficiently determined user
with a debugger can patch the client binary. **No design here prevents that** —
code signing, obfuscation, and anti-debugging raise cost but do not close it.

What this plan does achieve: casual tampering (clock changes, file edits, config
edits, copying the install) stops working, tampering becomes *detectable* on next
contact, and — most importantly — a compromise of one install stops being a
compromise of **every** restaurant's data, which is the situation today.

The mandatory online re-validation window is the real enforcement mechanism. Its
length is a business decision: shorter is more secure and less convenient. The
current 30-day monthly deadline is a reasonable default.

---

## 7. Open questions

1. **Re-validation window** — keep 30 days, or shorten?
2. **Hardware change policy** — self-service re-activation with a fresh token, or
   super-admin approval?
3. **VMs** — refuse, or allow with a flag?
4. **Server availability** — the authority becomes a hard dependency for
   activation. Acceptable, or does it need HA?
5. **Phase 1 appetite** — it is a real rewrite of the data path. If that is out of
   scope right now, say so and I will re-plan Phases 2–5 as best-effort
   mitigations within the current architecture, being explicit that they are
   speed bumps rather than a security boundary while `DATABASE_URL` still ships.
