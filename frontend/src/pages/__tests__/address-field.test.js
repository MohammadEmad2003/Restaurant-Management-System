/**
 * Tests for Feature 5: Detailed Address Field.
 * Verifies that delivery address inputs are multi-line textareas in both Orders and Clients pages.
 * Uses source-code regex auditing — no React rendering required.
 */
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ordersPath = path.resolve(__dirname, '../Orders.jsx');
const clientsPath = path.resolve(__dirname, '../Clients.jsx');
const enPath = path.resolve(__dirname, '../../i18n/en.js');
const arPath = path.resolve(__dirname, '../../i18n/ar.js');

/**
 * Reads the source code of the Orders page.
 * @returns {string} The file contents as a string.
 */
function ordersSource() {
  return fs.readFileSync(ordersPath, 'utf-8');
}

/**
 * Reads the source code of the Clients page.
 * @returns {string} The file contents as a string.
 */
function clientsSource() {
  return fs.readFileSync(clientsPath, 'utf-8');
}

/**
 * Reads an i18n language file.
 * @param {string} filePath - The absolute path to the language file.
 * @returns {string} The file contents as a string.
 */
function i18nSource(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

describe('Detailed Address Field', () => {
  /**
   * Tests that the delivery address field in Orders uses a textarea element.
   * Verifies the label and textarea are adjacent (within the same field block).
   * @returns {void}
   */
  test('Orders page uses textarea for delivery address', () => {
    const src = ordersSource();
    // The delivery address section should have the label followed immediately by a <textarea> with rows={3}
    // Pattern: <label>{t('orders.deliveryAddress'...)}<textarea className="textarea" rows={3} value={deliveryAddress}
    expect(src).toMatch(/orders\.deliveryAddress[\s\S]{0,200}<textarea[\s\S]*?rows=\{3\}/);
    // The textarea should be bound to deliveryAddress state
    expect(src).toMatch(/<textarea[\s\S]*?value=\{deliveryAddress\}[\s\S]*?setDeliveryAddress/);
  });

  /**
   * Tests that the Clients Add modal uses a textarea for address input.
   * @returns {void}
   */
  test('Clients Add modal uses textarea for address field', () => {
    const src = clientsSource();
    // The address field should use <textarea className="textarea" rows={3}>
    expect(src).toMatch(/<textarea[\s\S]*?className=["']textarea["'][\s\S]*?rows=\{3\}[\s\S]*?form\.address/);
  });

  /**
   * Tests that the delivery address placeholder suggests multi-line input in both languages.
   * @returns {void}
   */
  test('deliveryAddressPlaceholder key exists with multi-line hint in both languages', () => {
    const en = i18nSource(enPath);
    const ar = i18nSource(arPath);

    // English should have the new key with landmarks hint
    expect(en).toMatch(/deliveryAddressPlaceholder[\s\S]*?landmarks/);
    // Arabic should have the corresponding translation
    expect(ar).toMatch(/deliveryAddressPlaceholder[\s\S]*?معالم/);
  });
});
