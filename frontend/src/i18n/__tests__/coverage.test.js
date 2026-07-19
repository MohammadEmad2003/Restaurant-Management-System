import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import en from '../en.js';
import ar from '../ar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Flatten a nested translation object into a set of dot-notation leaf keys. */
function flatKeys(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatKeys(v, key, out);
    else out.add(key);
  }
  return out;
}

const enKeys = flatKeys(en);
const arKeys = flatKeys(ar);

describe('i18n coverage', () => {
  it('en and ar have identical key sets', () => {
    const missingInAr = [...enKeys].filter((k) => !arKeys.has(k));
    const missingInEn = [...arKeys].filter((k) => !enKeys.has(k));
    expect({ missingInAr, missingInEn }).toEqual({ missingInAr: [], missingInEn: [] });
  });

  it('every nav key used by the Sidebar exists in both languages', () => {
    // Extract the item `label:` and section `key:` values from the Sidebar's SECTIONS array.
    const sidebar = fs.readFileSync(path.resolve(__dirname, '../../layout/Sidebar.jsx'), 'utf-8');
    const labels = [...sidebar.matchAll(/\blabel:\s*'([^']+)'/g)].map((m) => m[1]);
    const sectionKeys = [...sidebar.matchAll(/\bkey:\s*'([^']+)'/g)].map((m) => m[1]);
    const navKeys = [...new Set([...labels, ...sectionKeys])].map((n) => `nav.${n}`);

    const missing = navKeys.filter((k) => !enKeys.has(k) || !arKeys.has(k));
    expect(missing, 'nav.* keys referenced by Sidebar but missing from a locale file').toEqual([]);
  });
});
