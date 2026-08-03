import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { syncEngine } from './sync/syncEngine.js';
import { sessionSweep } from './sessions/sessionSweep.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(helmet({
  // The built frontend is served from this same Express process (see below)
  // so Electron's packaged app can load it over http:// instead of file://
  // (where a relative `/api` fetch can't resolve to anything) — default
  // Helmet CSP would otherwise block Vite's build output.
  contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
if (config.env !== 'test') app.use(morgan('dev'));

// Health + meta
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  mode: config.persistenceMode,
  sync: syncEngine.status(),
  time: Date.now(),
}));

app.use('/api', routes);

// Serve the built frontend from this same process when it exists — this is
// what lets the packaged Electron app load the UI over http://localhost:<port>/
// instead of file://, so the frontend's relative `/api/...` calls resolve
// correctly without any base-URL special-casing. Two candidate locations:
// the dev-repo sibling (`../frontend/dist`, when running `node src/server.js`
// straight out of this checkout) and the packaged-app resource copy
// (`resources/frontend-dist`, sibling of `resources/backend` — copied there
// as a PLAIN directory via electron-builder's `extraResources`, deliberately
// NOT inside `app.asar`, since this backend runs as an independent forked
// Node process that cannot transparently read into an asar archive the way
// Electron's own patched main-process `fs` can). In normal backend-only
// dev/test (neither exists), this whole block is a no-op.
const frontendDist = [
  // `process.resourcesPath` is Electron's own authoritative pointer to the
  // packaged app's resources folder — checked first since it can't be thrown
  // off by any relative-path assumption about this file's own location.
  process.resourcesPath && path.join(process.resourcesPath, 'frontend-dist'),
  path.resolve(__dirname, '..', '..', 'frontend', 'dist'),
  path.resolve(__dirname, '..', '..', 'frontend-dist'),
].filter(Boolean).find(existsSync);
if (frontendDist) {
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
} else if (process.resourcesPath) {
  // Packaged (Electron) but the frontend bundle wasn't found anywhere expected —
  // this should never happen in a correctly built installer, so surface it loudly
  // instead of silently falling through to a bare 404 on every page load.
  logger.error(`Packaged frontend bundle not found (looked for "frontend-dist" under ${process.resourcesPath})`);
}

app.use(notFound);
app.use(errorHandler);

import { runMigrations } from './migrations/runMigrations.js';

async function start() {
  // Not a fatal boot guard: this backend is normally embedded inside the
  // packaged desktop app, which always runs with NODE_ENV=production but
  // never has a `.env` file bundled (see the extraResources filter in
  // frontend/package.json) — refusing to boot here would break every real
  // installation, not just insecure ones. This only matters for the
  // separate, optional "centralized backend" deployment mode (see
  // docs/ARCHITECTURE.md §14) — a loud warning is enough to catch that
  // misconfiguration without breaking the primary desktop use case.
  if (config.env === 'production' && config.jwtSecret === 'dev-secret-change-me') {
    logger.warn('JWT_SECRET is still the default dev value in a production environment — if this backend is reachable by anyone other than this one device, set a real JWT_SECRET immediately (anyone can forge a valid token, including a Super Admin token, using this well-known default).');
  }

  await runMigrations();

  // Mock-data seeding is opt-in only now (`npm run seed`) — real data comes
  // from Supabase/the local store, not an auto-generated demo dataset.

  // Boot the offline-first sync engine (no-op until Supabase configured).
  syncEngine.start();

  // Boot the idle-session sweep (releases abandoned cashier slots).
  sessionSweep.start();

  const server = app.listen(config.port, () => {
    logger.success(`Backend listening on http://localhost:${config.port}  (mode: ${config.persistenceMode})`);
    logger.info('API base: http://localhost:' + config.port + '/api');
  });

  // Clear, non-crashing message when the port is already taken (another server still running).
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${config.port} is already in use — another instance is still running.`);
      logger.info(`Free it first:  Linux/WSL: "fuser -k ${config.port}/tcp"  ·  Windows: "netstat -ano | findstr :${config.port}" then "taskkill /PID <pid> /F"`);
      logger.info(`Or run on a different port:  PORT=4001 npm run dev`);
      process.exit(1);
    }
    logger.error(`Server error: ${err.stack || err.message}`);
    process.exit(1);
  });
}

start().catch((err) => {
  logger.error(`Fatal: ${err.stack || err.message}`);
  process.exit(1);
});

export default app;
