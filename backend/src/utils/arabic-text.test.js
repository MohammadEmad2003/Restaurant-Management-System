import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { processArabicText as processPdfArabic } from './pdf.js';
import { processArabicText as processExcelArabic } from './excel.js';

const ARABIC_TEXT = 'نظام إدارة المطعم';
const MIXED_TEXT = 'المنتج ABC123';
const NUMBERS_ARABIC = 'السعر: ١٥٠ ريال';
const SPECIAL_CHARS = '، ؛ —';
const LONG_TEXT = 'هذا نص عربي طويل جداً لاختبار معالجة النصوص العربية في التقارير والتصدير';

/** Bidi reordering changes character positions, so check that all original
 *  characters are preserved (just reordered) rather than using includes(). */
function charsPreserved(original, result) {
  return [...original].sort().join('') === [...result].sort().join('');
}

describe('processArabicText — pdf.js', () => {
  test('returns valid string for pure Arabic text', () => {
    const result = processPdfArabic(ARABIC_TEXT);
    assert.equal(typeof result, 'string');
    assert.equal(result.length, ARABIC_TEXT.length, 'same character count');
    assert.ok(charsPreserved(ARABIC_TEXT, result), 'all characters preserved');
  });

  test('handles mixed Arabic + Latin text', () => {
    const result = processPdfArabic(MIXED_TEXT);
    assert.equal(typeof result, 'string');
    assert.equal(result.length, MIXED_TEXT.length, 'same character count');
    assert.ok(charsPreserved(MIXED_TEXT, result), 'all characters preserved');
  });

  test('preserves Arabic numbers in context', () => {
    const result = processPdfArabic(NUMBERS_ARABIC);
    assert.equal(typeof result, 'string');
    assert.equal(result.length, NUMBERS_ARABIC.length, 'same character count');
    assert.ok(charsPreserved(NUMBERS_ARABIC, result), 'all characters preserved');
  });

  test('handles empty string', () => {
    assert.equal(processPdfArabic(''), '');
  });

  test('passes through null/undefined', () => {
    assert.equal(processPdfArabic(null), null);
    assert.equal(processPdfArabic(undefined), undefined);
  });

  test('passes through non-string values', () => {
    assert.equal(processPdfArabic(42), 42);
    assert.deepEqual(processPdfArabic({}), {});
  });

  test('handles special Arabic punctuation', () => {
    const result = processPdfArabic(SPECIAL_CHARS);
    assert.equal(typeof result, 'string');
    assert.ok(charsPreserved(SPECIAL_CHARS, result), 'all characters preserved');
  });

  test('handles long Arabic text without truncation', () => {
    const result = processPdfArabic(LONG_TEXT);
    assert.equal(typeof result, 'string');
    assert.equal(result.length, LONG_TEXT.length, 'same character count');
    assert.ok(charsPreserved(LONG_TEXT, result), 'all characters preserved');
  });
});

describe('processArabicText — excel.js', () => {
  test('returns valid string for pure Arabic text', () => {
    const result = processExcelArabic(ARABIC_TEXT);
    assert.equal(typeof result, 'string');
    assert.equal(result.length, ARABIC_TEXT.length, 'same character count');
    assert.ok(charsPreserved(ARABIC_TEXT, result), 'all characters preserved');
  });

  test('handles mixed Arabic + Latin text', () => {
    const result = processExcelArabic(MIXED_TEXT);
    assert.equal(typeof result, 'string');
    assert.equal(result.length, MIXED_TEXT.length, 'same character count');
    assert.ok(charsPreserved(MIXED_TEXT, result), 'all characters preserved');
  });

  test('preserves Arabic numbers in context', () => {
    const result = processExcelArabic(NUMBERS_ARABIC);
    assert.equal(typeof result, 'string');
    assert.equal(result.length, NUMBERS_ARABIC.length, 'same character count');
    assert.ok(charsPreserved(NUMBERS_ARABIC, result), 'all characters preserved');
  });

  test('handles empty string', () => {
    assert.equal(processExcelArabic(''), '');
  });

  test('passes through non-string values', () => {
    assert.equal(processExcelArabic(42), 42);
    assert.equal(processExcelArabic(null), null);
  });
});

describe('consistency — both implementations produce identical output', () => {
  const samples = [ARABIC_TEXT, MIXED_TEXT, NUMBERS_ARABIC, SPECIAL_CHARS, LONG_TEXT];

  for (const sample of samples) {
    test(`"${sample}" produces same result in pdf.js and excel.js`, () => {
      assert.equal(processPdfArabic(sample), processExcelArabic(sample));
    });
  }
});
