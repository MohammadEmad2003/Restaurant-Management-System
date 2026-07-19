import PDFDocument from 'pdfkit';
import { readFileSync, writeFileSync } from 'fs';

// Create a minimal PDF with Arabic text to diagnose the rendering issue
const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });

// Register Arabic font
const fontBuf = readFileSync('fonts/NotoSansArabic-Regular.ttf');
doc.registerFont('NotoSansArabic', fontBuf);

const chunks = [];
doc.on('data', (c) => chunks.push(c));
doc.on('end', () => {
  const buf = Buffer.concat(chunks);
  writeFileSync('test-arabic-minimal.pdf', buf);
  console.log('PDF written: test-arabic-minimal.pdf');
  console.log('Size:', (buf.length / 1024).toFixed(1), 'KB');
});

// Test 1: Simple Arabic word (عمر = "Omar")
doc.font('NotoSansArabic').fontSize(24);
doc.text('Test 1 - Simple word:', 50, 50);
doc.text('عمر', 50, 70);

// Test 2: Two-word Arabic phrase (عمر حسن = "Omar Hassan")  
doc.text('Test 2 - Two words:', 50, 110);
doc.text('عمر حسن', 50, 130);

// Test 3: Longer Arabic sentence
doc.text('Test 3 - Sentence:', 50, 170);
doc.text('مرحبا بالعالم هذا اختبار', 50, 190);

// Test 4: Mixed English and Arabic
doc.text('Test 4 - Mixed:', 50, 230);
doc.text('Hello عمر World', 50, 250);

// Test 5: Numbers with Arabic
doc.text('Test 5 - Numbers:', 50, 290);
doc.text('السعر ١٢٥ ريال', 50, 310);

doc.end();
console.log('PDF generation complete');
