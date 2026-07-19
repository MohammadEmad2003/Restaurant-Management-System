import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const inventoryPath = path.resolve(__dirname, '../Inventory.jsx');
const source = () => fs.readFileSync(inventoryPath, 'utf8');

/**
 * Tests that the Add Item modal shows the unit next to quantity input.
 * @param {string} expectedUnit - The unit that should be visible (e.g., "kg").
 * @returns {void}
 */
test('Add Item modal displays unit suffix on quantity input', () => {
  const src = source();
  // The Add Item modal quantity field should render iForm.unit as a muted span next to the input
  expect(src).toContain("iForm.quantityAvailable");
  expect(src).toMatch(/iForm\.quantityAvailable[\s\S]{0,200}iForm\.unit/);
});

/**
 * Tests that the Restock modal shows the unit next to quantity input.
 * @param {string} expectedUnit - The unit that should be visible (e.g., "liters").
 * @returns {void}
 */
test('Restock modal displays unit suffix on quantity input', () => {
  const src = source();
  // The Restock modal quantity field should render purchase.unit as a muted span next to the input
  expect(src).toContain("pForm.quantity");
  expect(src).toMatch(/pForm\.quantity[\s\S]{0,200}purchase\?\.unit/);
});

/**
 * Tests that the DataTable quantity column includes unit information.
 * @returns {void}
 */
test('Inventory table shows quantity with units (e.g., "5.0 kg")', () => {
  const src = source();
  // The quantityAvailable column should render both num(v) and r.unit
  expect(src).toMatch(/quantityAvailable[\s\S]{0,300}num\(v\)[\s\S]{0,100}r\.unit/);
});
