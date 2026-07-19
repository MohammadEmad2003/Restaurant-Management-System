/**
 * Build a style object applying POS font size & family from settings.
 * @param {object} [settings] - The settings object from the API.
 * @returns {object} Style object with fontSize and optionally fontFamily.
 */
export function posFontStyle(settings) {
  const size = Number(settings?.posFontSize) || 14;
  const family = settings?.posFontFamily || 'inherit';
  return { fontSize: `${size}px`, fontFamily: family === 'inherit' ? undefined : family };
}
