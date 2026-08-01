import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'node:child_process';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const BACKEND_PORT = Number(process.env.PORT) || 4000;

let backendProcess = null;

/** Poll the backend's own health endpoint until it responds, so the window
 * is never shown before the API it depends on can actually serve requests. */
function waitForBackend(port, timeoutMs = 20000) {
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
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`Backend on port ${port} did not become ready in time`));
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
function startBackend() {
  if (isDev) return Promise.resolve();

  const backendEntry = path.join(process.resourcesPath, 'backend', 'src', 'server.js');
  const dataDir = path.join(app.getPath('userData'), 'backend-data');

  backendProcess = fork(backendEntry, [], {
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      DATA_DIR: dataDir,
      NODE_ENV: 'production',
    },
    stdio: 'inherit',
  });
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
