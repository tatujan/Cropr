<!-- Copied from the "Cropr redesign directions" design package (readme.md).
     The implementation lives in src/styles.css (tokens + components), index.html and src/main.js.
     See "Implementation notes" at the end for where the app differs from the package, and why. -->

# Cropr Design System

Cropr is a small, free, open-source web app that crops PDF shipping labels (FedEx, UPS, USPS, store exports) and prints them on 4×6 thermal or US-Letter paper. Everything runs **locally in the browser**: PDF.js renders the page at 300 DPI, canvas crops it, and the PNG is downloaded or printed. No backend, no account, no upload.

This system codifies **direction 2a "Clean"** from the redesign exploration (`Cropr Redesign.dc.html`, turn 2): the original single-column, stacked flow, refined, with Day / Dark / System themes.

## Sources

- Codebase: local folder `Cropr/` (`index.html`, `src/*.js`, `README.md`). Public repo: https://github.com/tatujan/Cropr
- Original UI screenshot: `uploads/Screenshot 2026-10-06 at 1.02.44 PM.png`
- Redesign mockups: `Cropr Redesign.dc.html` (2a = chosen direction), `CroprA.dc.html`
- Original palette in code (Tailwind): primary #10b981 (emerald-500), accent #f97316 (orange-500), dark #1e293b. The redesign keeps the green identity (moved to oklch hue 162) and drops orange as a second action color.

## Index

- `styles.css` — the one file to link (imports only)
- `tokens/` — `colors.css` (day + dark + system), `typography.css`, `spacing.css` (space, radii, shadow, motion), `fonts.css`, `base.css`
- `components/`
  - `core/` Button, IconButton, SegmentedControl, Switch, Badge, Icon
  - `layout/` Panel, PanelSection, SiteHeader, SiteFooter, ThemeToggle, Wordmark
  - `workflow/` Dropzone, FileBar, PageStrip, CropStage, PaperOption, Alert
  - `content/` StepCard, PrivacyNote
  - `preview/` PdfPage, LabelArt (stand-ins for PDF.js canvases)
- `ui_kits/cropr-web/` — interactive click-through of the full app
- `guidelines/` — foundation specimen cards
- `assets/icons/` — Heroicons v1 SVGs copied from the codebase
- `preview-shim.js` — lets the card/kit preview pages load component files directly
- `SKILL.md` — Agent Skill entry point

### Component inventory note

The codebase has no component library (one Tailwind HTML file). The inventory was derived from the elements the app actually renders — dropzone, error message, file/progress, page nav, Auto/Manual buttons, B&W checkbox, crop stage with 8 handles, output preview, Download/Print/Reset, How-it-works steps, footer — plus the features the redesign added (theme toggle, batch page strip, paper choice, rotate).

**Intentional additions:** ThemeToggle (day/dark requested), PageStrip (batch PDFs), PaperOption (4×6 vs Letter), IconButton (rotate), Wordmark (header lockup), PdfPage/LabelArt (preview stand-ins so mocks don't need PDF.js).

## CONTENT FUNDAMENTALS

- **Voice:** plain, quick, reassuring. A tool, not a brand. Say what happens and stop.
- **Person:** address the user as "you" ("Your file never leaves your browser"). Cropr is the subject when describing what the app does ("Cropr finds the label, crops it…"). Never "we".
- **Casing:** sentence case everywhere — headings, buttons, labels ("Download PNG", "Start over", "Ready to print"). Lowercase "cropr" only in the wordmark; "Cropr" in running text.
- **Buttons:** verb first, 1–3 words: Select PDF, Print label, Print all 3 labels, Download PNG, Apply crop, Replace, Start over. Counts go in the label when batching.
- **Numbers & units:** use the × sign and inches as people say them: "4×6", "8.5 × 11 in", "300 DPI". File meta in mono: "3 pages · 212 KB". Middle dot "·" separates facts.
- **Privacy line:** always present near upload, short: "Processed locally in your browser. Your file is never uploaded."
- **Errors:** say what happened, then the fix, no blame: "That file isn't a PDF — Save the label as a PDF and try again."
- **Emoji:** never. Unicode marks only where functional (✓ ↺ ↻ × ·).
- **Examples:** H1 "Crop shipping labels in one click." · Eyebrow "Free · No sign-up · Works offline" · Helper "Same crop applied to all 3 pages." · Step "Drop the PDF / Crop automatically / Print or save".

## VISUAL FOUNDATIONS

- **Color:** one accent — Cropr green (oklch hue 162). Day uses a deeper green (L .60) with white text; dark uses a lighter green (L .76) with near-black text. Neutrals are faintly green-tinted grays (never pure #000/#fff backgrounds except paper and surface). Red (hue 25) only for errors. No gradients anywhere (the old UI's gradients and shimmer progress bar are retired).
- **Themes:** `[data-theme="light"|"dark"]` on `<html>`; no attribute = follow `prefers-color-scheme` (the "System" option, default). Paper/label previews stay white in both modes because that is what prints.
- **Type:** Geist for everything; Geist Mono for file meta, dimensions, step numbers and overlines-in-mono. Headlines bold with tight negative tracking (−0.04em display, −0.03em h2). Body 15–17px at 1.5 line-height. No serif, no all-caps headlines (the only caps are the 12px overline "HOW IT WORKS" at +0.06em).
- **Layout:** single centered column, max 880px, 40px side padding (16px mobile). Stacked flow: header → hero/dropzone → workspace panel → output panel → how it works → footer. Inside panels, sections are full-width bands split by 1px hairlines.
- **Backgrounds:** flat `--bg`. Recessed "well" bands (`--well`) hold anything paper-like (PDF page, label). No imagery, textures or patterns.
- **Cards/panels:** `--surface`, 1px `--border`, radius 18, **no shadow**. Step cards radius 16. Dropzone radius 20 with 1.5px dashed `--border-strong`.
- **Elevation:** UI is flat; only paper casts shadows (`--shadow-page` for PDF pages, `--shadow-label` for the output label) and the segmented thumb gets a 1px lift.
- **Corner radii:** grow with size — 5 (canvas tags) · 8 (segment thumb) · 10 (buttons, inputs, paper options) · 11 (large button) · 16 · 18 · 20 · pill (theme toggle, eyebrow badge, switch).
- **Borders:** 1px hairlines in `--border`; selected states use a 2px `--accent` border plus `--accent-wash` fill (paper options, current page thumb, drag-over dropzone).
- **Crop language:** kept area = 2px green outline; discarded area = `--scrim` overlay. Manual handles are round white dots with green rings (14px; 22px on touch) at 4 corners + 4 edges.
- **Hover:** primary buttons brighten slightly (brightness 1.07); secondary/ghost get a `--surface-2` fill; nav links go from muted to text color. **Press:** 1px downward nudge. **Focus:** `--focus-ring` (green halo).
- **Motion:** quick and functional — 120ms for color, 200ms with `cubic-bezier(.4,0,.2,1)` for switch knobs, rotation, drag-over. No bounces, no page transitions, no shimmer.
- **Transparency/blur:** only the crop scrim and accent washes use alpha. No blur.
- **Imagery:** none beyond the user's own label. Placeholders for labels are drawn as neutral b/w stand-ins.

## ICONOGRAPHY

- The codebase uses inline **Heroicons v1** SVG paths (outline 24px for upload/document/chevrons, solid 20px for download/printer/refresh) plus the GitHub mark. These exact paths are copied into `assets/icons/*.svg` and the `Icon` component — do not substitute another set.
- Icons are sparing: upload in the dropzone, printer/download on output buttons, chevrons for page nav. Navigation and settings rows are text-only.
- Unicode is used where Heroicons v1 has no clean glyph: ↺ ↻ (rotate), ✓ (included page / success), × (dismiss), · (separator).
- Theme toggle glyphs are CSS shapes (screen outline, ring, filled disc), not icons.
- No emoji, no icon font, no PNG icons.
- **Logo:** the source has no logo (blank favicon). The green tile + crop-corner "cropr" lockup (`Wordmark`) is a **provisional mark from the redesign**, not an official logo.

## Fonts

Geist and Geist Mono load from Google Fonts (`tokens/fonts.css`). No font binaries were in the source; the original app used the Tailwind system stack. Swap in self-hosted files if you need offline support.

## Implementation notes

How the package maps to the code, and where the app differs on purpose.

- **No component library.** The package's React components are plain HTML in `index.html` with one CSS class for each component in `src/styles.css` (`.btn-*`, `.panel`, `.segmented`, `.switch`, `.paper-option`, `.alert`, `.dropzone`, `.page-thumb`, `.crop-box`, `.step`). The tokens are copied from `tokens/*.css` without changes.
- **Fonts are self-hosted** (`@fontsource-variable/geist`, `@fontsource-variable/geist-mono`), not loaded from Google Fonts. The CSP (`font-src 'self'`, `style-src 'self'`) and offline use need this. The family names are `Geist Variable` and `Geist Mono Variable`.
- **Theme before first paint.** `public/theme-init.js` (an external file, so the CSP allows it) sets `data-theme` from localStorage key `cropr-theme`. No key = System.
- **No label detection.** The mockups say "Cropr finds the label" and "3 labels found". The app does not detect labels. Auto crop takes the top half of a Letter/A4/Legal page (or the whole page if it is label-sized) and trims the white space around the dark content. The UI text says only that ("Top half · white space trimmed").
- **True size.** Labels print at their real size (scale ≤ 1); they turn 90° when that fits better, and the rotate buttons add to that. Without the trim step, a Letter half-page label would print on 4×6 at about 68 %.
- **Manual crop applies to all pages.** The kit says "Applies to this page only", but the turn-2 notes say the crop applies to all pages. One crop for a batch of the same carrier layout is more useful. The flow is Manual → drag → Apply crop (or Cancel), then Edit crop.
- **Batch download** of more than one label is one ZIP file (`shipping-labels.zip`), because browsers block many downloads at once.
- **Removed demo items:** "Demo: try a non-PDF", "up to 5 MB" (the app has no size limit), and the "Sent to printer" alert (the browser does not report if the user printed or cancelled).
- **Privacy link** goes to a short, factual privacy section on the page (`#privacy`).
- **Selection outline** is a CSS `outline`, not a `border`, so the clear area inside the box is exactly the crop. Handles are 14 px, and 22 px on touch screens (`pointer: coarse`).
