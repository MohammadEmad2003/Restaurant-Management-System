import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Scan CSS content for physical directional properties that should be replaced
 * with logical equivalents for proper RTL support.
 *
 * @param {string} cssContent - The CSS file content to analyze.
 * @returns {Array<{line: number, text: string, property: string}>} Array of violations found.
 */
function findPhysicalCSSProperties(cssContent) {
    const patterns = [
        { regex: /margin-left\s*:/gi, property: 'margin-left → margin-inline-start/end' },
        { regex: /margin-right\s*:/gi, property: 'margin-right → margin-inline-end/start' },
        { regex: /padding-left\s*:/gi, property: 'padding-left → padding-inline-start' },
        { regex: /padding-right\s*:/gi, property: 'padding-right → padding-inline-end' },
        { regex: /text-align:\s*left/gi, property: 'text-align: left → text-align: start' },
        { regex: /text-align:\s*right/gi, property: 'text-align: right → text-align: end' },
        { regex: /border-left\s*:/gi, property: 'border-left → border-inline-start' },
        { regex: /border-right\s*:/gi, property: 'border-right → border-inline-end' },
        { regex: /left:\s*\d/gi, property: 'left: px → inset-inline-start' },
        { regex: /right:\s*\d/gi, property: 'right: px → inset-inline-end' },
    ];

    const lines = cssContent.split('\n');
    const violations = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip the .ltr class rule — it intentionally forces LTR for phone numbers
        if (line.includes('.ltr') && line.includes('text-align: right')) continue;

        for (const { regex, property } of patterns) {
            if (regex.test(line)) {
                violations.push({ line: i + 1, text: line.trim(), property });
            }
        }
    }

    return violations;
}

/**
 * Scan JSX inline styles for physical directional properties that should use
 * logical equivalents (marginInlineStart, marginInlineEnd, etc.) for RTL support.
 *
 * @param {string} jsxContent - The JSX file content to analyze.
 * @returns {Array<{line: number, text: string, property: string}>} Array of violations found.
 */
function findPhysicalInlineStyles(jsxContent) {
    const patterns = [
        { regex: /marginLeft\s*:/gi, property: 'marginLeft → marginInlineStart/End' },
        { regex: /marginRight\s*:/gi, property: 'marginRight → marginInlineEnd/Start' },
        { regex: /paddingLeft\s*:/gi, property: 'paddingLeft → paddingInlineStart' },
        { regex: /paddingRight\s*:/gi, property: 'paddingRight → paddingInlineEnd' },
        { regex: /textAlign:\s*['"]left['"]/gi, property: "textAlign: 'left' → 'start'" },
        { regex: /textAlign:\s*['"]right['"]/gi, property: "textAlign: 'right' → 'end'" },
        { regex: /borderLeft\s*:/gi, property: 'borderLeft → borderInlineStart' },
        { regex: /borderRight\s*:/gi, property: 'borderRight → borderInlineEnd' },
    ];

    const lines = jsxContent.split('\n');
    const violations = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (const { regex, property } of patterns) {
            if (regex.test(line)) {
                violations.push({ line: i + 1, text: line.trim(), property });
            }
        }
    }

    return violations;
}

describe('RTL Layout Audit', () => {
    const FRONTEND_SRC = path.resolve(__dirname, '..');

    it('globals.css has no physical directional properties', () => {
        const cssPath = path.join(FRONTEND_SRC, 'styles', 'globals.css');
        const content = fs.readFileSync(cssPath, 'utf-8');

        const violations = findPhysicalCSSProperties(content);

        for (const v of violations) {
            console.error(`  Line ${v.line}: ${v.property} — "${v.text}"`);
        }

        expect(violations, `Found ${violations.length} physical CSS property violation(s) in globals.css`).toHaveLength(0);
    });

    it('ui.jsx inline styles are RTL-safe', () => {
        const jsxPath = path.join(FRONTEND_SRC, 'components', 'ui.jsx');
        const content = fs.readFileSync(jsxPath, 'utf-8');

        const violations = findPhysicalInlineStyles(content);

        for (const v of violations) {
            console.error(`  Line ${v.line}: ${v.property} — "${v.text}"`);
        }

        expect(violations, `Found ${violations.length} physical inline style violation(s) in ui.jsx`).toHaveLength(0);
    });
});
