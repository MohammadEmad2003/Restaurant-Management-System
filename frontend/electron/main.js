import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const BACKEND_PORT = Number(process.env.PORT) || 4000;

let backendProcess = null;
// Last handful of lines the embedded backend printed before either becoming
// ready or dying — `stdio: 'inherit'` alone gives a user who launched via
// double-click (no attached terminal) zero visibility into why a generic
// "did not become ready" dialog happened; this makes the real reason (a
// crash, a missing dependency, a port conflict) show up IN the dialog itself.
const recentBackendOutput = [];
function recordBackendOutput(chunk) {
  const text = chunk.toString();
  process.stdout.write(text); // still visible in a terminal, if one is attached
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    recentBackendOutput.push(line);
    if (recentBackendOutput.length > 20) recentBackendOutput.shift();
  }
}

/** True if something is already listening on this port — almost always a
 * previous instance of this same app that didn't shut down cleanly (a
 * force-quit, a crash, or simply a second copy already running), the single
 * most common real-world reason "backend did not become ready" happens,
 * exactly like the plain "npm run dev" backend already detects and reports
 * clearly for itself in dev (see backend/src/server.js's EADDRINUSE handler)
 * — this gives the packaged app the same clarity instead of a generic
 * timeout with no indication of the actual cause. */
function isPortTaken(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 800 });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
}

/** Poll the backend's own health endpoint until it responds, so the window
 * is never shown before the API it depends on can actually serve requests. */
function waitForBackend(port, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const attempt = () => {
      const req = http.get({ host: 'localhost', port, path: '/api/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      // The backend process exiting is a hard failure — no amount of extra
      // waiting will ever make a dead process start answering requests.
      if (backendProcess === null) {
        return reject(new Error(`Backend exited before it became ready.${recentBackendOutput.length ? `\n\n${recentBackendOutput.join('\n')}` : ''}`));
      }
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error(`Backend on port ${port} did not become ready in time.${recentBackendOutput.length ? `\n\n${recentBackendOutput.join('\n')}` : ''}`));
      }
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

/**
 * Embed the Express backend directly in the packaged app — this is what
 * makes the desktop app genuinely offline-first once installed: without
 * this, a packaged build loads the frontend over `file://` with no backend
 * anywhere for its relative `/api/...` calls to reach. Spawned as a child
 * process (not imported in-process) so a backend crash never takes down the
 * whole Electron main process, and so its own `pg`/native dependencies never
 * need to be loaded into Electron's own Node runtime.
 *
 * `DATA_DIR` is pointed at Electron's own per-user, OS-appropriate data
 * folder (`app.getPath('userData')`) — never the app's installed/resources
 * folder, which may be read-only and is wiped/replaced on reinstall/update.
 * This is exactly what makes the persistent local JSON store (and the sync
 * outbox) survive reinstalls, updates, and computer restarts.
 *
 * In dev, the backend is expected to already be running separately (`npm
 * run dev` in `backend/`, same as this project's existing dev workflow) —
 * nothing is spawned here, matching how `loadURL` already points at the
 * separately-running Vite dev server below.
 */
async function startBackend() {
  if (isDev) return;

  // By far the most common real-world reason the backend "never becomes
  // ready" is a previous instance of this same app still holding the port —
  // a force-quit, a crash, or simply launching a second copy while the first
  // is still running. Check for it explicitly up front so that case gets a
  // clear, specific message instead of a generic 45-second timeout.
  if (await isPortTaken(BACKEND_PORT)) {
    throw new Error(
      `Port ${BACKEND_PORT} is already in use — another copy of this app (or something else) is already running.\n`
      + `Close it first, then relaunch. If nothing visible is running, check for a leftover background process using this port.`,
    );
  }

  const backendEntry = path.join(process.resourcesPath, 'backend', 'src', 'server.js');
  const dataDir = path.join(app.getPath('userData'), 'backend-data');

  backendProcess = fork(backendEntry, [], {
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      DATA_DIR: dataDir,
      NODE_ENV: 'production',
    },
    // 'pipe' (not 'inherit') so output can be captured for the error dialog
    // below — a double-click launch has no attached terminal for 'inherit'
    // to usefully show anything on anyway.
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  backendProcess.stdout.on('data', recordBackendOutput);
  backendProcess.stderr.on('data', recordBackendOutput);
  backendProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`Backend process exited unexpectedly (code=${code}, signal=${signal})`);
    }
    backendProcess = null;
  });

  return waitForBackend(BACKEND_PORT);
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Bella Cucina — Restaurant Management',
    backgroundColor: '#f6f7fb',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173').catch((err) => {
      console.error('Dev server unreachable on http://localhost:5173 — is "npm run dev" running?', err.message);
    });
  } else {
    // The backend now also serves the built frontend (see server.js) — load
    // it over http://, not file://, so relative `/api/...` calls resolve to
    // this same origin exactly as they do via Vite's dev proxy.
    win.loadURL(`http://localhost:${BACKEND_PORT}/`);
  }
}

// Native print dialog (used by the receipt/report flows).
ipcMain.handle('print', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win?.webContents.print({ silent: false });
});

// Native "save report" file dialog.
ipcMain.handle('save-file', async (e, { defaultPath }) => {
  const { filePath } = await dialog.showSaveDialog({ defaultPath });
  return filePath;
});

app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err) {
    console.error('Failed to start the embedded backend:', err);
    await dialog.showMessageBox({
      type: 'error',
      title: 'Startup Error',
      message: 'The local backend service failed to start. The app cannot continue.',
      detail: String(err?.message || err),
    });
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopBackend);
