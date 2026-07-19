/** Direct fontkit test — bypass pdfkit entirely to check if NotoSansArabic 
 *  font properly shapes Arabic text via GSUB tables. */
import { readFileSync } from 'fs';
import fontkit from 'fontkit';

const fontBuf = readFileSync('fonts/NotoSansArabic-Regular.ttf');
const font = fontkit.create(fontBuf);

console.log('=== Font Info ===');
console.log('Family:', font.familyName);
console.log('Subfamily:', font.subfamilyName);
console.log('Units per em:', font.unitsPerEm);
console.log('Glyph count:', font.glyphCount);

// Check for GSUB table (glyph substitution)
const hasGSUB = font.tables && 'GSUB' in font.tables;
console.log('\n=== OpenType Tables ===');
console.log('Has GSUB:', hasGSUB);

// Check for GPOS table (glyph positioning)  
const hasGPOS = font.tables && 'GPOS' in font.tables;
console.log('Has GPOS:', hasGPOS);

// List all tables
if (font.tables) {
  console.log('Tables:', Object.keys(font.tables).join(', '));
}

// Test shaping with different texts
const testStrings = [
  'عمر',
  'عمر حسن',
  'مرحبا بالعالم',
  'Hello عمر World'
];

console.log('\n=== Glyph Shaping Tests ===');
for (const text of testStrings) {
  console.log(`\nText: "${text}"`);
  
  // Create glyphs for this text — font.layout() returns a GlyphRun object
  const glyphRun = font.layout(text);
  
  console.log('  Type:', typeof glyphRun);
  console.log('  Is array?', Array.isArray(glyphRun));
  
  if (Array.isArray(glyphRun)) {
    console.log('  Glyph count:', glyphRun.length);
    console.log('  Glyph IDs:', glyphRun.map(g => g.id).join(', '));
    
    // Check if any glyphs are the "missing glyph" (usually ID 0)
    const missingGlyphs = glyphRun.filter(g => g.id === 0);
    if (missingGlyphs.length > 0) {
      console.log('  ⚠️  Missing glyphs (tofu):', missingGlyphs.length);
    } else {
      console.log('  ✓ No missing glyphs');
    }
  } else {
    // It's a GlyphRun object — access its properties
    console.log('  Keys:', Object.keys(glyphRun));
    if (glyphRun.glyphs) {
      console.log('  Glyph count:', glyphRun.glyphs.length);
      console.log('  Glyph IDs:', glyphRun.glyphs.map(g => g.id).join(', '));
      
      // Check if any glyphs are the "missing glyph" (usually ID 0)
      const missingGlyphs = glyphRun.glyphs.filter(g => g.id === 0);
      if (missingGlyphs.length > 0) {
        console.log('  ⚠️  Missing glyphs (tofu):', missingGlyphs.length);
      } else {
        console.log('  ✓ No missing glyphs');
      }
    }
  }
  
  // Check direction property
  console.log('  Direction:', glyphRun.direction);
  console.log('  Script:', glyphRun.script);
  console.log('  Language:', glyphRun.language);
}

// Test specific Arabic characters and their contextual forms
console.log('\n=== Contextual Form Analysis ===');
const arabicChars = ['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ر', 'س'];
for (const char of arabicChars) {
  const glyphRun = font.layout(char);
  if (Array.isArray(glyphRun) && glyphRun.length > 0) {
    console.log(`"${char}" → glyph ID: ${glyphRun[0].id}, name: ${glyphRun[0].name || 'N/A'}`);
  } else if (glyphRun.glyphs && glyphRun.glyphs.length > 0) {
    console.log(`"${char}" → glyph ID: ${glyphRun.glyphs[0].id}, name: ${glyphRun.glyphs[0].name || 'N/A'}`);
  }
}
