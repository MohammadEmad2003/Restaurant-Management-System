/**
 * Only present inside the packaged Electron app (see electron/preload.js) —
 * a plain browser tab has no access to real hardware identifiers, and
 * shouldn't: activation from a browser against the centrally-hosted
 * authority simply proceeds without hardware binding for that install.
 */
export async function getHardwareComponents() {
  if (!window.desktop?.getHardwareComponents) return null;
  try {
    return await window.desktop.getHardwareComponents();
  } catch {
    return null;
  }
}

export default { getHardwareComponents };
