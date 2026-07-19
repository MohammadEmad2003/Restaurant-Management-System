/**
 * Test: Pass features parameter to doc.text() to skip word-splitting in pdfkit
 * 
 * When features is passed, pdfkit's Font.layout() calls layoutRun() directly
 * instead of splitting by words, which should preserve the full GlyphRun
 * including the direction property.
 */

import PDFDocument from 'pdfkit';
import { readFileSync, writeFileSync } from 'fs';

const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });

// Register Arabic font
const fontBuf = readFileSync('fonts/NotoSansArabic-Regular.ttf');
doc.registerFont('NotoSansArabic', fontBuf);

const chunks = [];
doc.on('data', (c) => chunks.push(c));
doc.on('end', () => {
  const buf = Buffer.concat(chunks);
  writeFileSync('test-features-param.pdf', buf);
  console.log('PDF written: test-features-param.pdf');
  console.log('Size:', (buf.length / 1024).toFixed(1), 'KB');
});

// Test with features parameter (should bypass word-splitting)
doc.font('NotoSansArabic').fontSize(24);

// Test 1: Simple word
doc.text('Test 1 - Simple word:', 50, 50);
doc.text('عمر', 50, 70, { features: {} });

// Test 2: Two words (the bug case)
doc.text('Test 2 - Two words:', 50, 110);
doc.text('عمر حسن', 50, 130, { features: {} });

// Test 3: Longer sentence
doc.text('Test 3 - Sentence:', 50, 170);
doc.text('مرحبا بالعالم هذا اختبار', 50, 190, { features: {} });

// Test 4: Mixed English and Arabic
doc.text('Test 4 - Mixed:', 50, 230);
doc.text('Hello عمر World', 50, 250, { features: {} });

// Test 5: Numbers with Arabic
doc.text('Test 5 - Numbers:', 50, 290);
doc.text('السعر ١٢٥ ريال', 50, 310, { features: {} });

// Test 6: Common names
doc.text('Test 6 - Names:', 50, 350);
doc.text('أحمد محمد علي', 50, 370, { features: {} });

doc.end();
console.log('PDF generation complete');
