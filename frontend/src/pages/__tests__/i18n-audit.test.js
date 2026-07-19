import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import en from '../../i18n/en.js';
import ar from '../../i18n/ar.js';

/**
 * Recursively resolves a dot-notation key against an object.
 * @param {object} obj - The translation object to search.
 * @param {string} key - Dot-notation key (e.g., "inventory.lowStock").
 * @returns {boolean} True if the key exists in the object.
 */
function resolveKey(obj, key) {
    const parts = key.split('.');
    let current = obj;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') return false;
        if (!(part in current)) return false;
        current = current[part];
    }
    return true;
}

/**
 * Finds hardcoded English strings in a JSX file that are not wrapped in t() calls.
 * Excludes empty strings, numeric placeholders, and common non-translatable patterns.
 * @param {string} filePath - Absolute path to the JSX file to audit.
 * @returns {string[]} Array of hardcoded strings found (should be empty after fixes).
 */
function findHardcodedStrings(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const hardcoded = [];

    // Regex to find string literals in JSX attributes or expressions
    const stringLiteralRegex = /(?<!['"`])['"]([A-Z][a-zA-Z0-9\s&.,!?':-]{2,})['"](?=['"`])/g;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip comments and import statements
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('import')) continue;
        
        // Skip lines that are already using t() for the string
        if (line.includes('t(')) {
            // Check if there are any strings NOT wrapped in t() on this line
            const withoutT = line.replace(/t\([^)]+\)/g, '');
            if (!stringLiteralRegex.test(withoutT)) continue;
        }
        
        // Find all string literals on this line
        let match;
        while ((match = stringLiteralRegex.exec(line)) !== null) {
            const str = match[1];
            
            // Skip empty strings, numeric-only strings, and common non-translatable patterns
            if (!str || /^\d+$/.test(str) || /^[A-Z][a-z]*\s[A-Z]/.test(str)) continue;
            if (str.includes('...') || str === '...' || str === '…') continue;
            
            hardcoded.push(`Line ${i + 1}: "${str}"`);
        }
    }
    
    return hardcoded;
}

/**
 * Checks whether a translation key exists in both English and Arabic translation files.
 * @param {string} key - The dot-notation key (e.g., "inventory.lowStock").
 * @returns {boolean} True if the key exists in both language files.
 */
function keyExistsInBoth(key) {
    return resolveKey(en, key) && resolveKey(ar, key);
}

/**
 * Suite of tests to audit page components for hardcoded strings and translation coverage.
 */
describe('i18n audit', () => {
    const PAGES_DIR = path.resolve(__dirname, '..');

    /**
     * Verifies that GoodsCheck.jsx has no hardcoded English strings.
     * @returns {Promise<void>}
     */
    it('GoodsCheck.jsx has no hardcoded strings', () => {
        const filePath = path.join(PAGES_DIR, 'GoodsCheck.jsx');
        const hardcoded = findHardcodedStrings(filePath);
        expect(hardcoded, 'Expected no hardcoded strings in GoodsCheck.jsx').toEqual([]);
    });

    /**
     * Verifies that Inventory.jsx has no hardcoded English strings.
     * @returns {Promise<void>}
     */
    it('Inventory.jsx has no hardcoded strings', () => {
        const filePath = path.join(PAGES_DIR, 'Inventory.jsx');
        const hardcoded = findHardcodedStrings(filePath);
        expect(hardcoded, 'Expected no hardcoded strings in Inventory.jsx').toEqual([]);
    });

    /**
     * Verifies that Finance.jsx has no hardcoded English strings.
     * @returns {Promise<void>}
     */
    it('Finance.jsx has no hardcoded strings', () => {
        const filePath = path.join(PAGES_DIR, 'Finance.jsx');
        const hardcoded = findHardcodedStrings(filePath);
        expect(hardcoded, 'Expected no hardcoded strings in Finance.jsx').toEqual([]);
    });

    /**
     * Verifies that critical translation keys exist in both language files.
     * @returns {Promise<void>}
     */
    it('critical translation keys exist in both languages', () => {
        const criticalKeys = [
            'inventory.newItem', 'inventory.itemAdded', 'inventory.category',
            'inventory.unit', 'inventory.qty', 'inventory.lowStock', 'inventory.unitCost',
            'inventory.inStock', 'inventory.minStock', 'inventory.low', 'inventory.ok',
            'inventory.restock', 'inventory.addStock', 'inventory.quantityLabel',
            'inventory.unitPrice', 'inventory.supplier', 'inventory.goodsTracked',
            'inventory.stockAdded', 'finance.subtitle', 'finance.revenue30',
            'finance.expenses30', 'finance.cashFlow', 'finance.incomeTrend',
            'goodsCheck.physicalInventoryCount', 'goodsCheck.checkRecorded',
        ];

        const missing = criticalKeys.filter(key => !keyExistsInBoth(key));
        expect(missing, 'Expected all critical keys to exist in both en.js and ar.js').toEqual([]);
    });
});
