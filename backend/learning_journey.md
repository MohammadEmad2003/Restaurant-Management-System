# Arabic RTL PDF Rendering - Learning Journey

## Problem Statement
Arabic text in generated PDFs renders incorrectly:
1. Letters appear disconnected (isolated glyph forms instead of connected)
2. Text appears flipped/reversed (e.g., `عمر حسن` renders as `رمعنسح`)
3. Empty rectangles (tofu boxes) appear for some characters

## Root Cause Analysis

### pdfkit Architecture
- **pdfkit** uses **fontkit** internally for font rendering and OpenType GSUB/GPOS shaping
- fontkit can properly shape Arabic text (contextual glyph forms: initial/medial/final/isolated)
- fontkit auto-detects RTL direction and sets `GlyphRun.direction = 'rtl'` for Arabic text
- When direction is 'rtl', fontkit reverses glyphs and positions for correct visual order

### The Bug in pdfkit
- **Font.layout()** method has a word-splitting optimization for multi-word text
- It splits text by spaces, calls `layoutCached()` per word, then concatenates results
- **Critical bug:** The concatenation only extracts `.glyphs` and `.positions`, losing the `.direction` property
- Without `direction = 'rtl'`, the RTL reversal code in fontkit's GPOS position() is never triggered
- Result: Arabic glyphs stay in logical order but get drawn left-to-right → garbled output

### Why Single Words Might Work
- Text without spaces bypasses word-splitting and calls `layoutRun()` directly
- This preserves the full GlyphRun including direction property
- However, most Arabic text has spaces, so this is rarely the case

## Solutions Tried

### 1. arabic-persian-reshaper + bidi-js (FAILED)
**Date:** Initial attempt
**Approach:** Use `arabic-persian-reshaper` to reshape Arabic letters, then `bidi-js` to get visual order
**Why it failed:**
- Double-shaping: arabic-persian-reshaper pre-reorders text for visual display, but fontkit's GSUB shaping needs LOGICAL order
- When characters are pre-reversed, fontkit can't determine proper initial/medial/final forms
- Result: isolated glyphs render as disconnected letters
**Lesson:** Do NOT pre-process Arabic text before passing to a library that does its own shaping

### 2. Remove bidi-js and arabic-persian-reshaper (PARTIAL - didn't fix PDF)
**Date:** After discovering double-shaping issue
**Approach:** Made `processArabicText()` a no-op, let pdfkit/fontkit handle everything
**Why it partially worked:**
- Eliminated double-shaping issue
- fontkit CAN properly shape Arabic text (verified with direct fontkit tests)
- However, the actual PDF output STILL shows garbled text due to pdfkit's layout() bug
**Lesson:** The shaping engine (fontkit) is fine, but pdfkit's wrapper loses critical RTL metadata

### 3. Direct fontkit testing (DIAGNOSTIC - confirmed font works)
**Date:** After removing bidi-js
**Approach:** Bypass pdfkit entirely and test fontkit directly with Arabic text
**Findings:**
- Font properly shapes Arabic: "عمر" → 3 glyphs, "عمر حسن" → 7 glyphs, "مرحبا بالعالم" → 13 glyphs
- No missing glyphs for pure Arabic text
- GlyphRun has correct properties: `{glyphs, positions, script='arab', language, direction='rtl', features}`
- fontkit auto-detects RTL and sets direction correctly
**Lesson:** The font (NotoSansArabic) and fontkit are working correctly. The bug is in pdfkit's Font.layout() method

### 4. Monkey-patching Font.prototype.layout (NOT YET TESTED PROPERLY)
**Date:** Current attempt
**Approach:** Patch pdfkit's Font.layout() to preserve direction property when concatenating per-word results
**Challenge:** The layout() method returns a plain object `{glyphs, positions, advanceWidth}` - not a GlyphRun
- Simply adding `direction` back won't trigger RTL reversal since that happens INSIDE fontkit
- Need to either: (a) reverse glyphs/positions ourselves after layout, or (b) find another approach

## Alternative Approaches to Try

### Option A: pdfkit with manual RTL handling
- Reverse the Arabic text string BEFORE passing to doc.text()
- Since fontkit shapes based on character context, reversing may break shaping
- **Risk:** May cause incorrect glyph forms

### Option B: Use pdfkit features parameter
- Passing `features: {}` to doc.text() might skip word-splitting
- Need to test if this preserves RTL direction through layoutRun()

### Option C: Switch to a different PDF library
- **pdf-lib:** Modern PDF library, check RTL support
- **puppeteer/playwright:** Generate PDFs from HTML (browser handles RTL natively)
- **jspdf:** Check Arabic/RTL support
- **docx:** Generate Word documents instead (better RTL support)

### Option D: Pre-render Arabic text as images
- Use canvas to render Arabic text (with proper font)
- Embed as image in PDF
- **Downside:** Not selectable/searchable text, larger file size

### Option E: Use a dedicated RTL text library with pdfkit
- Find a library that properly handles RTL text layout for pdfkit
- Look for packages like `pdfkit-rtl` or similar

### 5. Pass `{features: {}}` to doc.text() — ✅ WORKING FIX
**Date:** Final working solution
**Approach:** Pass `{features: {}}` to `doc.text()` calls for Arabic text
**Why it works:**
- When `features` is passed (even as empty object), pdfkit's `Font.layout()` takes a different code path
- It calls `layoutRun()` directly instead of the word-splitting optimization
- This preserves the full GlyphRun object including `direction='rtl'`
- With direction preserved, fontkit's GPOS position() properly reverses glyphs for RTL visual order
**Implementation:**
- Created `textArabic(doc, str, x, y, opts)` helper: `doc.text(str, x, y, { features: {}, ...opts })`
- Applied to all ~30+ doc.text() calls across drawBarChart(), renderReportPdf(), renderMultiReportPdf(), renderInvoicePdfAr()
- Made `processArabicText()` a no-op (bidi-js reordering was breaking fontkit GSUB shaping)
**Result:** Arabic text renders with connected letters in proper RTL order ✅

## Final Solution Summary
1. **Root Cause:** pdfkit's `Font.layout()` word-splitting optimization loses the `direction` property from fontkit's GlyphRun
2. **Fix:** Pass `{features: {}}` to `doc.text()` to bypass word-splitting and preserve RTL direction
3. **Key Insight:** Keep Arabic text in LOGICAL order (no bidi reordering) — let fontkit handle both shaping AND visual layout
4. **Files Changed:** pdf.js, excel.js — all doc.text() calls for Arabic content now use `{features: {}}`
