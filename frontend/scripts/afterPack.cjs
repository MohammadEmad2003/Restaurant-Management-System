const fs = require('fs');
const path = require('path');

/**
 * electron-builder's `extraResources` "filter" allowlist copies plain files
 * fine (backend/src, backend/package.json) but silently skips a FOREIGN
 * project's `node_modules` (it isn't part of this frontend package's own
 * dependency graph, so electron-builder's "smart" node_modules handling
 * excludes it even when explicitly listed in the filter). Copying it here,
 * after packaging, with a plain recursive filesystem copy sidesteps that
 * entirely — this is what actually lets the embedded backend (spawned by
 * electron/main.js) run standalone in the packaged app, since it needs its
 * own express/pg/bcryptjs/etc. dependencies physically present.
 */
exports.default = async function afterPack(context) {
  const backendNodeModules = path.join(__dirname, '..', '..', 'backend', 'node_modules');
  const dest = path.join(context.appOutDir, 'resources', 'backend', 'node_modules');
  if (!fs.existsSync(backendNodeModules)) {
    console.warn('[afterPack] backend/node_modules not found — run npm install in backend/ first');
    return;
  }
  fs.cpSync(backendNodeModules, dest, { recursive: true });
  console.log(`[afterPack] copied backend/node_modules → ${dest}`);
};
