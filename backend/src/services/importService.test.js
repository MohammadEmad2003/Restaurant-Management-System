import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { importService } from './importService.js';
import { createTestRestaurant } from '../test-helpers/fixtures.js';

async function buildXlsx(headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(headers);
  for (const row of rows) ws.addRow(headers.map((h) => row[h]));
  return wb.xlsx.writeBuffer();
}

// Regression: shape() used to pre-coerce numeric cells with `Number(...)`
// before validate() ever ran — turning a blank/non-numeric cell into `NaN`,
// which then silently passed validate()'s check (`typeof NaN === 'number'`
// in JS), corrupting the product's price permanently on import.
test('importService rejects a product row with a non-numeric price instead of silently importing NaN', async () => {
  const buffer = await buildXlsx(
    ['name', 'category', 'price'],
    [{ name: 'Bad Item', category: 'Main', price: 'TBD' }],
  );
  const validation = await importService.validateFile('products', buffer);
  assert.equal(validation.valid, 0, 'a non-numeric price must fail validation, not silently pass as NaN');
  assert.equal(validation.invalid, 1);
  assert.ok(validation.results[0].errors.some((e) => e.includes('price')), 'the error must call out the price field specifically');
});

test('importService rejects a product row with a blank price (required field)', async () => {
  const buffer = await buildXlsx(
    ['name', 'category', 'price'],
    [{ name: 'Blank Price Item', category: 'Main', price: '' }],
  );
  const validation = await importService.validateFile('products', buffer);
  assert.equal(validation.valid, 0);
  assert.ok(validation.results[0].errors.some((e) => e.includes('price')));
});

test('importService still imports a genuinely valid numeric price correctly', async () => {
  const { restaurant } = await createTestRestaurant();
  const buffer = await buildXlsx(
    ['name', 'category', 'price'],
    [{ name: 'Good Item', category: 'Main', price: 42.5 }],
  );
  const result = await importService.importFile('products', buffer, { restaurantId: restaurant.id });
  assert.equal(result.imported, 1);
  assert.equal(result.results[0].data.price, 42.5);
});

// Regression: the same NaN-bypass bug applied to goods (quantityAvailable,
// purchasePrice, minimumStockLevel) and workers (salary) imports.
test('importService rejects a goods row with a non-numeric quantityAvailable', async () => {
  const buffer = await buildXlsx(
    ['name', 'unit', 'quantityAvailable', 'purchasePrice', 'minimumStockLevel'],
    [{ name: 'Flour', unit: 'kg', quantityAvailable: 'lots', purchasePrice: 5, minimumStockLevel: 1 }],
  );
  const validation = await importService.validateFile('goods', buffer);
  assert.equal(validation.valid, 0);
  assert.ok(validation.results[0].errors.some((e) => e.includes('quantityAvailable')));
});

test('importService rejects a worker row with a non-numeric salary', async () => {
  const buffer = await buildXlsx(
    ['name', 'username', 'role', 'salary'],
    [{ name: 'New Hire', username: 'newhire1', role: 'cashier', salary: 'lots of money' }],
  );
  const validation = await importService.validateFile('workers', buffer);
  assert.equal(validation.valid, 0);
  assert.ok(validation.results[0].errors.some((e) => e.includes('salary')));
});
