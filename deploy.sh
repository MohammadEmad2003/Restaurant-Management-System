#!/usr/bin/env bash
#
# Redeploy Bella Cucina RMS on this server.
#
# What this actually does, in order:
#   1. Preflight — verify every tool/file the deploy depends on exists BEFORE
#      touching anything, so a missing prerequisite fails on a still-running
#      site instead of halfway through with the service already stopped.
#   2. Bring up the production Postgres container if it isn't running.
#   3. Install backend + frontend dependencies from their lockfiles.
#   4. Build the frontend (backend/src/server.js serves frontend/dist).
#   5. Restart restaurant-backend.service — this is also what applies any
#      schema changes, since config/database.js's ensureSchema() and
#      migrations/runMigrations.js both run idempotently on every boot.
#   6. Poll /api/health until it answers, and roll the frontend back if it
#      doesn't.
#
# Deliberately NOT done here:
#   - Nothing writes to backend/.env, deploy/.env.db, or any other secret.
#     Those are created once, by hand, on the server and are gitignored.
#   - nginx is left alone (its config is static; see deploy/nginx/). Pass
#     --reload-nginx if you actually changed it.
#   - The Windows installer is not rebuilt (slow, needs wine). Pass
#     --installer if you want it.
#
# Usage:
#   ./deploy.sh                 # build + restart from the current working tree
#   ./deploy.sh --pull          # git pull first
#   ./deploy.sh --test          # run the backend test suite before deploying
#   ./deploy.sh --installer     # also rebuild the Windows installer
#   ./deploy.sh --reload-nginx  # validate + reload nginx too
#   ./deploy.sh --help

set -Eeuo pipefail

# Resolve the repo root from this script's own location, so the script works
# no matter what directory it's invoked from (cron, another shell, CI).
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

SERVICE="restaurant-backend.service"
COMPOSE_PROJECT="restaurant-prod"
COMPOSE_FILE="deploy/docker-compose.db.yml"
COMPOSE_ENV="deploy/.env.db"
HEALTH_TIMEOUT_SECS=90

DO_PULL=0
DO_TEST=0
DO_INSTALLER=0
DO_NGINX=0

# ── Output helpers ──────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[90m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_OFF=''
fi
step() { printf '\n%s==>%s %s\n' "$C_OK" "$C_OFF" "$*"; }
info() { printf '%s    %s%s\n' "$C_DIM" "$*" "$C_OFF"; }
warn() { printf '%s  ! %s%s\n' "$C_WARN" "$*" "$C_OFF"; }
die()  { printf '\n%s  ✖ %s%s\n' "$C_ERR" "$*" "$C_OFF" >&2; exit 1; }

usage() { sed -n '2,/^set -Eeuo/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//; $d'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull)         DO_PULL=1 ;;
    --test)         DO_TEST=1 ;;
    --installer)    DO_INSTALLER=1 ;;
    --reload-nginx) DO_NGINX=1 ;;
    -h|--help)      usage ;;
    *) die "Unknown option: $1  (try --help)" ;;
  esac
  shift
done

# Restored by the trap below if anything after the frontend build fails —
# see the build step for why this matters.
DIST_BACKUP=""
# Only becomes 1 once the service has actually been restarted. Service logs
# are the useful diagnostic for a failed startup, but pure noise for a
# preflight failure (a missing .env, no docker) where nothing was touched.
TOUCHED_SERVICE=0
cleanup_on_error() {
  local rc=$?
  [[ $rc -eq 0 ]] && return 0
  if [[ -n "$DIST_BACKUP" && -d "$DIST_BACKUP" ]]; then
    warn "Restoring the previous frontend build."
    rm -rf frontend/dist
    mv "$DIST_BACKUP" frontend/dist
    [[ $TOUCHED_SERVICE -eq 1 ]] && systemctl restart "$SERVICE" 2>/dev/null || true
  fi
  printf '\n%s  ✖ Deploy FAILED (exit %s).%s\n' "$C_ERR" "$rc" "$C_OFF" >&2
  if [[ $TOUCHED_SERVICE -eq 1 ]]; then
    printf '%s    Recent service logs:%s\n' "$C_DIM" "$C_OFF" >&2
    journalctl -u "$SERVICE" -n 25 --no-pager 2>/dev/null >&2 || true
  fi
  exit "$rc"
}
trap cleanup_on_error EXIT

# ── 1. Preflight ────────────────────────────────────────────────────
# Everything here is checked while the site is still up and untouched, so a
# missing prerequisite never leaves the service stopped mid-deploy.
step "Preflight checks"

[[ $EUID -eq 0 ]] || die "Must run as root (systemctl restart + docker need it). Try: sudo ./deploy.sh"

for cmd in node npm docker systemctl curl; do
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
done
docker compose version >/dev/null 2>&1 || die "'docker compose' (v2) is required."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 18 ]] || die "Node 18+ required (found $(node -v))."

systemctl list-unit-files "$SERVICE" >/dev/null 2>&1 \
  || die "$SERVICE is not installed on this host. Expected unit: /etc/systemd/system/$SERVICE"

# These hold real secrets, are gitignored, and are created once by hand — a
# deploy must never silently continue without them (the backend would fall
# back to its local-JSON store and quietly serve the wrong data).
[[ -f backend/.env ]]        || die "backend/.env is missing. Copy backend/.env.example and fill in the real values."
[[ -f "$COMPOSE_ENV" ]]      || die "$COMPOSE_ENV is missing (POSTGRES_PASSWORD for the database container)."
[[ -f "$COMPOSE_FILE" ]]     || die "$COMPOSE_FILE is missing."

# This host is the License Authority (see backend/src/config/index.js). If
# that flag is ever lost, activation silently breaks for EVERY customer —
# their installs proxy here and would get a 404 back — so it's worth failing
# loudly at deploy time rather than discovering it from a support ticket.
if ! grep -qE '^IS_LICENSE_AUTHORITY=true[[:space:]]*$' backend/.env; then
  die "backend/.env does not set IS_LICENSE_AUTHORITY=true.
      This server is the central License Authority; without that flag every
      customer's activation request gets a 404. Fix backend/.env and re-run."
fi

# Port the service actually listens on, read from the same .env it loads —
# hardcoding 8090 here would silently health-check the wrong thing the day
# someone changes it.
APP_PORT="$(grep -E '^PORT=' backend/.env | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
APP_PORT="${APP_PORT:-8090}"
info "Node $(node -v) · service $SERVICE · port $APP_PORT"

# ── 2. Update the working tree ──────────────────────────────────────
if [[ $DO_PULL -eq 1 ]]; then
  step "Pulling latest code"
  command -v git >/dev/null 2>&1 || die "git not found but --pull was requested."
  if [[ -n "$(git status --porcelain)" ]]; then
    warn "Working tree has uncommitted changes:"
    git status --short | sed 's/^/      /'
    die "Refusing to pull over local changes. Commit, stash, or drop --pull."
  fi
  git pull --ff-only
fi
info "Deploying commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'n/a') $(git log -1 --pretty=%s 2>/dev/null || true)"

# ── 3. Database container ───────────────────────────────────────────
step "Ensuring production Postgres is up"
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$COMPOSE_ENV" up -d
# Wait for the container's own healthcheck (pg_isready) rather than a fixed
# sleep — the backend fails over to its local JSON store if Postgres isn't
# reachable at boot, which would look like a successful deploy serving stale
# data.
for _ in $(seq 1 30); do
  state="$(docker inspect -f '{{.State.Health.Status}}' "${COMPOSE_PROJECT}-db-1" 2>/dev/null || echo unknown)"
  [[ "$state" == "healthy" ]] && break
  sleep 2
done
[[ "${state:-unknown}" == "healthy" ]] || die "Postgres container did not become healthy (state: ${state:-unknown})."
info "Postgres healthy."

# ── 4. Dependencies ─────────────────────────────────────────────────
# `npm ci` for a reproducible, lockfile-exact install. It fails hard when the
# lockfile and package.json disagree — surface that clearly rather than
# silently papering over it, since a drifted lockfile means the deployed
# dependency tree isn't the one that was tested.
install_deps() {
  local dir="$1"
  step "Installing dependencies: $dir"
  ( cd "$dir" && npm ci --no-audit --no-fund ) \
    || die "npm ci failed in $dir/. The lockfile is likely out of sync with package.json —
      run 'npm install' there locally, commit the updated package-lock.json, and redeploy."
}
install_deps backend
install_deps frontend

# ── 5. Tests (opt-in) ───────────────────────────────────────────────
# Off by default: the suite runs single-threaded and takes several minutes,
# which is a long time to hold a deploy. Worth it before anything touching
# auth/licensing.
if [[ $DO_TEST -eq 1 ]]; then
  step "Running backend test suite"
  ( cd backend && npm test ) || die "Backend tests failed — not deploying."
  step "Running frontend test suite"
  ( cd frontend && npm test -- --run ) || die "Frontend tests failed — not deploying."
fi

# ── 6. Build the frontend ───────────────────────────────────────────
# vite empties outDir at the start of the build, so a build that fails
# partway leaves frontend/dist empty — and since the backend serves that
# directory, the site would start returning blank pages. Keep the previous
# build aside so the EXIT trap can put it back.
step "Building frontend"
if [[ -d frontend/dist ]]; then
  DIST_BACKUP="frontend/.dist-prev-$$"
  rm -rf "$DIST_BACKUP"
  cp -a frontend/dist "$DIST_BACKUP"
fi
( cd frontend && npm run build )
[[ -f frontend/dist/index.html ]] || die "Build finished but frontend/dist/index.html is missing."
info "Built $(find frontend/dist -type f | wc -l) files."

# ── 7. Restart the service ──────────────────────────────────────────
# This is also what applies schema changes: config/database.js's
# ensureSchema() and migrations/runMigrations.js are both idempotent and run
# on every boot, so there is no separate migration step to forget.
step "Restarting $SERVICE"
TOUCHED_SERVICE=1
systemctl restart "$SERVICE"

# ── 8. Health check ─────────────────────────────────────────────────
step "Waiting for the backend to report healthy"
deadline=$(( SECONDS + HEALTH_TIMEOUT_SECS ))
healthy=0
while (( SECONDS < deadline )); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  # A dead unit will never become healthy — fail immediately instead of
  # burning the full timeout waiting for a process that already exited.
  if ! systemctl is-active --quiet "$SERVICE"; then
    die "$SERVICE stopped while starting up."
  fi
  sleep 2
done
[[ $healthy -eq 1 ]] || die "Backend did not answer /api/health within ${HEALTH_TIMEOUT_SECS}s."

HEALTH_JSON="$(curl -fsS --max-time 5 "http://127.0.0.1:${APP_PORT}/api/health")"
info "$HEALTH_JSON"

# The backend starts fine even when Postgres is unreachable (by design — it
# fails over to the local JSON store). On THIS host that failover means
# serving stale data and breaking activation for every customer, so treat it
# as a deploy failure rather than a silent success.
if ! grep -q '"online":true' <<<"$HEALTH_JSON"; then
  die "Backend is up but reports Postgres OFFLINE — it has failed over to the local JSON store.
      Check DATABASE_URL in backend/.env and that the database container is reachable."
fi

# ── 9. Optional extras ──────────────────────────────────────────────
if [[ $DO_NGINX -eq 1 ]]; then
  step "Validating + reloading nginx"
  nginx -t || die "nginx config test failed — not reloading."
  systemctl reload nginx
fi

if [[ $DO_INSTALLER -eq 1 ]]; then
  step "Rebuilding the Windows installer (this takes ~10 minutes)"
  command -v wine >/dev/null 2>&1 \
    || die "wine is not installed — electron-builder needs it to generate the NSIS uninstaller.
      Install it with: dpkg --add-architecture i386 && apt-get update && apt-get install -y wine wine32:i386"
  ( cd frontend && WINEDEBUG=-all npm run dist:win )
  installer="$(ls -t dist-installer/*.exe 2>/dev/null | head -1)"
  [[ -n "$installer" ]] || die "Installer build reported success but no .exe was produced."
  info "Installer: $installer"
  info "SHA-256:   $(sha256sum "$installer" | cut -d' ' -f1)"
fi

# ── Done ────────────────────────────────────────────────────────────
rm -rf "$DIST_BACKUP" 2>/dev/null || true
DIST_BACKUP=""
trap - EXIT

printf '\n%s==> Deploy OK%s  ·  %s  ·  port %s  ·  commit %s\n\n' \
  "$C_OK" "$C_OFF" "$SERVICE" "$APP_PORT" "$(git rev-parse --short HEAD 2>/dev/null || echo n/a)"
