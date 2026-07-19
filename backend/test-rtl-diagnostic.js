import PDFDocument from 'pdfkit';
import { readFileSync, writeFileSync } from 'fs';

// Load the Arabic font
const fontBuf = readFileSync('fonts/NotoSansArabic-Regular.ttf');

// Create PDF with multiple approaches to RTL text
const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
doc.registerFont('NotoSansArabic', fontBuf);

const chunks = [];
doc.on('data', (c) => chunks.push(c));
doc.on('end', () => {
  const buf = Buffer.concat(chunks);
  writeFileSync('test-rtl-diagnostic.pdf', buf);
  console.log('PDF written: test-rtl-diagnostic.pdf');
  console.log('Size:', (buf.length / 1024).toFixed(1), 'KB');
});

let y = 50;

// Test 1: Arabic text with default alignment
doc.font('NotoSansArabic').fontSize(20);
doc.text('Test 1 - Default (left align):', 50, y);
y += 30;
doc.text('عمر حسن', 50, y);
y += 40;

// Test 2: Arabic text with right alignment
doc.text('Test 2 - Right align:', 50, y);
y += 30;
doc.text('عمر حسن', 50, y, { align: 'right' });
y += 40;

// Test 3: Arabic text with explicit direction (if supported)
doc.text('Test 3 - With direction rtl:', 50, y);
y += 30;
doc.text('عمر حسن', 50, y, { direction: 'rtl' });
y += 40;

// Test 4: Longer Arabic sentence
doc.text('Test 4 - Long sentence:', 50, y);
y += 30;
doc.text('مرحبا بالعالم هذا اختبار للنص العربي', 50, y, { width: 500 });
y += 40;

// Test 5: Mixed English and Arabic
doc.text('Test 5 - Mixed:', 50, y);
y += 30;
doc.text('Hello عمر World', 50, y);
y += 40;

// Test 6: Numbers in Arabic
doc.text('Test 6 - Arabic numbers:', 50, y);
y += 30;
doc.text('السعر هو ١٢٥ ريال', 50, y);
y += 40;

// Test 7: Bilingual text (English — Arabic)
doc.text('Test 7 - Bilingual:', 50, y);
y += 30;
doc.text('Restaurant — مطعم الأمواج', 50, y);
y += 40;

// Test 8: Using Helvetica (built-in font, no Arabic support) for comparison
doc.font('Helvetica').fontSize(20);
doc.text('Test 8 - Helvetica with Arabic (should be tofu):', 50, y);
y += 30;
doc.text('عمر حسن', 50, y);

doc.end();
console.log('PDF generation complete');
