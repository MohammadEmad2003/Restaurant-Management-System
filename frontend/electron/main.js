import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

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
    // dotenv (config/index.js's `dotenv.config()`) resolves `.env` relative to
    // the child process's cwd, not to server.js's own location — this must
    // match where extraResources copies backend/.env.electron to
    // (resources/backend/.env, see frontend/package.json) for the bundled
    // production DATABASE_URL to actually be picked up.
    cwd: path.join(process.resourcesPath, 'backend'),
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

let _cachedHardwareComponents = null;

/**
 * Collected here in the MAIN process — trusted, unlike the renderer/preload
 * sandbox, which a compromised page could otherwise feed fake values through
 * — and cached for the app's lifetime (hardware doesn't change mid-session,
 * and re-querying WMI on every activation/heartbeat would be wasteful).
 * This is the identity the license authority binds a device to (see
 * backend's hardwareBindingService.js) — deliberately independent of the
 * existing browser-characteristics fingerprint (frontend/src/utils/
 * fingerprint.js), which changing display resolution or OS language already
 * alters and so is not a suitable anchor for "is this the same physical
 * machine".
 */
async function collectHardwareComponents() {
  if (_cachedHardwareComponents) return _cachedHardwareComponents;
  const result = { board: '', systemUuid: '', disk: '', cpu: '' };
  try {
    if (process.platform === 'win32') {
      const script = [
        '$ErrorActionPreference = "SilentlyContinue"',
        '$board = (Get-CimInstance Win32_BaseBoard).SerialNumber',
        '$uuid = (Get-CimInstance Win32_ComputerSystemProduct).UUID',
        '$disk = (Get-CimInstance Win32_DiskDrive | Sort-Object Index | Select-Object -First 1).SerialNumber',
        '$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId',
        '[PSCustomObject]@{ board = $board; systemUuid = $uuid; disk = $disk; cpu = $cpu } | ConvertTo-Json -Compress',
      ].join('; ');
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 8000 },
      );
      const parsed = JSON.parse(stdout.trim() || '{}');
      result.board = String(parsed.board || '').trim();
      result.systemUuid = String(parsed.systemUuid || '').trim();
      result.disk = String(parsed.disk || '').trim();
      result.cpu = String(parsed.cpu || '').trim();
    } else if (process.platform === 'linux') {
      // Best-effort only — this app's shipped/supported target is Windows;
      // Linux here is strictly a development environment, never where
      // hardware binding is actually exercised against the real authority.
      try { result.board = fs.readFileSync('/sys/class/dmi/id/board_serial', 'utf8').trim(); } catch { /* often root-only — fine to skip */ }
      try { result.systemUuid = fs.readFileSync('/sys/class/dmi/id/product_uuid', 'utf8').trim(); } catch { /* same */ }
    }
  } catch (err) {
    console.error('Hardware ID collection failed:', err.message);
  }

  // If every field came back empty (a VM with stripped SMBIOS, a permission
  // issue, a non-Windows dev machine), fall back to a random value persisted
  // under userData — still a stable per-installation identity (survives
  // restarts, so binding still works), just not tied to physical hardware.
  // This does NOT mask a genuine hardware change on a real Windows install:
  // all four WMI fields failing at once there isn't a realistic case — it
  // only covers environments the real fields were never expected to work in.
  if (!result.board && !result.systemUuid && !result.disk && !result.cpu) {
    const fallbackFile = path.join(app.getPath('userData'), '.hardware-fallback-id');
    try {
      result.board = fs.readFileSync(fallbackFile, 'utf8').trim();
    } catch {
      result.board = crypto.randomUUID();
      try {
        fs.mkdirSync(path.dirname(fallbackFile), { recursive: true });
        fs.writeFileSync(fallbackFile, result.board);
      } catch { /* best effort — worst case this just re-generates next launch */ }
    }
  }

  _cachedHardwareComponents = result;
  return result;
}

ipcMain.handle('get-hardware-components', () => collectHardwareComponents());

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
