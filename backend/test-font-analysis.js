import { readFileSync } from 'fs';
import fontkit from 'fontkit';

// Load and analyze the Arabic font
const fontBuf = readFileSync('fonts/NotoSansArabic-Regular.ttf');
const font = fontkit.create(fontBuf);

console.log('=== Font Analysis ===');
console.log('Family:', font.familyName);
console.log('Subfamily:', font.subfamilyName);
console.log('Glyph count:', font.outlines?.length || font.numGlyphs || 'unknown');

// Check for GSUB table (glyph substitution - critical for Arabic shaping)
const hasGsub = font.tables && 'GSUB' in font.tables;
if (hasGsub) {
  console.log('\n✓ GSUB table found (Arabic shaping supported)');
} else {
  console.log('\n✗ NO GSUB table - Arabic shaping NOT possible!');
}

// Check for GPOS table (glyph positioning)
const hasGpos = font.tables && 'GPOS' in font.tables;
if (hasGpos) {
  console.log('✓ GPOS table found (glyph positioning supported)');
} else {
  console.log('✗ NO GPOS table');
}

// Test shaping a simple Arabic word
console.log('\n=== Shaping Test: "عمر" (Omar) ===');
const testStr = 'عمر';
console.log('Input string:', testStr);
console.log('Characters:', [...testStr].map(c => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} (${c})`).join(', '));

// Get glyphs for the string
const layout = font.layout(testStr);
console.log('\nGlyphs produced by fontkit:');
for (const glyph of layout.glyphs) {
  console.log(`  Glyph ID: ${glyph.id}, Advance: ${glyph.advanceWidth}`);
}

// Test with full phrase
console.log('\n=== Shaping Test: "عمر حسن" (Omar Hassan) ===');
const testStr2 = 'عمر حسن';
console.log('Input string:', testStr2);
const layout2 = font.layout(testStr2);
console.log('Glyphs produced by fontkit:');
for (const glyph of layout2.glyphs) {
  console.log(`  Glyph ID: ${glyph.id}, Advance: ${glyph.advanceWidth}`);
}
