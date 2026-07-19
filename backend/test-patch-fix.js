import PDFDocument from 'pdfkit';
import { readFileSync, writeFileSync } from 'fs';

// Create a test PDF to verify the monkey-patch fix
const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });

// Register Arabic font
const fontBuf = readFileSync('fonts/NotoSansArabic-Regular.ttf');
doc.registerFont('NotoSansArabic', fontBuf);

// === THE FIX: Monkey-patch Font.prototype.layout to preserve RTL direction ===
// pdfkit's layout() splits text by spaces, then concatenates per-word GlyphRuns
// into {glyphs, positions, advanceWidth} — losing the `direction` property.
// This patch preserves direction so fontkit's RTL reversal code can work.
const Font = PDFDocument.prototype.registerFont.toString().includes('prototype') 
  ? PDFDocument.Font 
  : null;

// Get access to the Font class through a document instance
const _doc = new PDFDocument();
_doc.registerFont('temp', readFileSync('fonts/NotoSansArabic-Regular.ttf'));
const fontInstance = _doc.fonts[Object.keys(_doc.fonts)[0]];

// Patch the layout method on the prototype
const OriginalFont = Object.getPrototypeOf(fontInstance).constructor;
const originalLayout = OriginalFont.prototype.layout;

OriginalFont.prototype.layout = function(text, features, onlyWidth) {
  // If features are passed, use original (skips word-splitting anyway)
  if (features) {
    return originalLayout.call(this, text, features, onlyWidth);
  }
  
  const result = originalLayout.call(this, text, features, onlyWidth);
  
  // If result has direction property (from layoutRun), return as-is
  if (result && result.direction) {
    return result;
  }
  
  // Otherwise, detect direction from the text itself
  // Arabic script range: U+0600 to U+06FF, U+FB50 to U+FDFF, U+FE70 to U+FEFF
  const arabicRegex = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  
  // Count Arabic vs non-Arabic characters (excluding spaces)
  let arabicCount = 0;
  let totalCount = 0;
  for (const char of text) {
    if (char === ' ' || char === '\t') continue;
    totalCount++;
    if (arabicRegex.test(char)) {
      arabicCount++;
    }
  }
  
  // If majority of characters are Arabic, mark as RTL
  if (totalCount > 0 && arabicCount > totalCount / 2) {
    result.direction = 'rtl';
  } else {
    result.direction = 'ltr';
  }
  
  return result;
};

// Now test the patched version
const chunks = [];
doc.on('data', (c) => chunks.push(c));
doc.on('end', () => {
  const buf = Buffer.concat(chunks);
  writeFileSync('test-patch-fix.pdf', buf);
  console.log('PDF written: test-patch-fix.pdf');
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

// Test 4: Mixed English and Arabic (will be LTR - expected)
doc.text('Test 4 - Mixed:', 50, 230);
doc.text('Hello عمر World', 50, 250);

// Test 5: Numbers with Arabic
doc.text('Test 5 - Numbers:', 50, 290);
doc.text('السعر ١٢٥ ريال', 50, 310);

// Test 6: Common names and words
doc.text('Test 6 - Names:', 50, 350);
doc.text('أحمد محمد علي', 50, 370);

doc.end();
console.log('PDF generation complete');
