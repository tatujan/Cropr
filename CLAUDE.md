# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Cropr is a client-side web app. It crops shipping labels from a PDF and prints them, or downloads them as a US Letter PNG. All processing occurs in the browser. The PDF never goes to a server. It is deployed on Vercel (`cropr.vercel.app`).

## Commands

```bash
npm run dev                                   # Vite dev server, http://localhost:5173
npm run build                                 # production build in dist/
npm run check                                 # lint + format:check + typecheck + unit tests (same as CI)
npm test                                      # unit tests (Vitest, test/unit/)
npx vitest run test/unit/png.test.js          # one unit test file
npm run test:e2e                              # Playwright, Chromium + Firefox + WebKit, against the production build
npx playwright test -g "keyboard" --project=chromium   # one browser test
npm run format                                # Prettier
```

`predev` and `prebuild` run `scripts/copy-pdfjs-assets.js`. It copies the PDF.js wasm decoders, standard fonts, CMaps and ICC profiles to `public/pdfjs/` (gitignored).

## Architecture

- `index.html` – markup (Tailwind classes, ARIA attributes). No inline scripts or styles, because the CSP blocks them.
- `print.html` + `src/print.css` – the page that the hidden print frame loads.
- `src/main.js` – UI wiring and state (DOM, PDF.js, pointer and keyboard events, download, print).
- `src/compose.js` – draws the crop area and makes the PNG (needs the DOM).
- `src/geometry.js`, `src/image.js`, `src/png.js` – pure functions with no DOM access. Vitest covers them. Put new pure logic here, not in `main.js`.
- `src/styles.css` – Tailwind 4 entry (`@theme` holds the custom colors `primary`, `secondary`, `accent`, `dark`) and custom CSS.
- `vercel.json` – the one source of the security headers. `vite.config.js` reads it and applies the same headers to `vite preview`, so the Playwright tests run under the production CSP. Exception: the preview server drops `Cross-Origin-Opener-Policy`, because it makes Playwright's Firefox hang on `page.goto` in about 1 of 25 runs.

All code is JavaScript with JSDoc types. `npm run typecheck` runs TypeScript 7 in strict `checkJs` mode. With TypeScript 7, a `@typedef` must be directly above a declaration. Do not name a type `Selection` (it clashes with the DOM type). The crop type is `CropSelection`.

### Data flow

1. `loadFile` → `showPage` → `renderPage`: PDF.js renders one page into `#originalCanvas` at 300 DPI (`intent: 'print'`). A render generation counter and `renderTask.cancel()` stop old renders when the user changes pages quickly. Free a document with `pdf.loadingTask.destroy()` (PDF.js 6 has no `PDFDocumentProxy.destroy`).
2. A **CropSelection** `{x, y, w, h}` is in **fractions (0..1) of the page**. Auto mode uses `AUTO_SELECTION` (top half). Manual mode uses `state.selection`, which the user changes with `#selectionBox` (pointer or keyboard, `selectionFromKey`).
3. `selectionToPixels` converts the selection to bitmap pixels. `makeLabelPng` (`src/compose.js`) draws that area on a label canvas at its final size (`fitOnHalfLetter`: the top half of a 2550×3300 Letter page at 300 DPI). A portrait label (ratio > 1.2) turns 90° clockwise. Manual crops have a 60 px margin. Auto crops have no margin.
4. Black and white (default): `toMask` (threshold 160) makes a 1 = black mask. `placeMask` puts it on a white Letter page. `encodeBilevelPng` (`src/png.js`) writes a 1-bit grayscale PNG in JavaScript.
   - **Do not export the output with `canvas.toBlob`/`toDataURL`.** Safari (Advanced Fingerprinting Protection), Brave and Firefox (resistFingerprinting) add noise to canvas read-back. White becomes 250–254, and printers print that as diagonal gray streaks. The threshold removes noise that `getImageData` adds. The custom encoder keeps noise out of the file. The e2e test "canvas read-back noise does not reach the PNG" simulates this noise.
   - The mask must come from the **last** pixel operation. Scaling after it adds gray anti-aliased pixels again.
   - When the user turns black and white off, the output goes through `toBlob`, and it can contain this noise.
5. The PNG Blob becomes an object URL (`state.outputUrl`). `#croppedCanvas` shows the label part, as it prints.
6. Download uses `<a download>`. Print loads `print.html` in a hidden same-origin frame, sets the image `src` to the blob URL, and calls `print()` on the frame when the image has loaded.

### Manual selection: one coordinate space

`#selectionBox` and the four overlay `div`s are in `#cropStage`. `#cropStage` has the same size as the page canvas. The code sets their positions as **percentages**, directly from the selection fractions. Thus the box and the crop always align, at any window size. Keep these rules:

- `#originalCanvas` must not have a border or padding, and it must fill `#cropStage` (`block w-full h-auto`).
- The selection box uses `outline`, not `border`, so the visible clear area is the crop area.
- Drag code converts pointer movement to fractions with the size of `#cropStage` at `pointerdown`. Pointer capture keeps the gesture on the box.

### Constraints from the CSP and the service worker

- The CSP is `script-src 'self' 'wasm-unsafe-eval'; style-src 'self'`. Do not add inline `<script>`, `<style>`, `style="…"` attributes, or third-party origins. Setting `element.style` from JavaScript is allowed.
- `vite-plugin-pwa` precaches the app shell, the PDF.js worker, wasm and standard fonts (`workbox.globPatterns` in `vite.config.js`). CMaps are cached at runtime. A new asset type must be in `globPatterns` to work offline.

### Tests

- Unit tests: `test/unit/`. Browser tests: `test/e2e/`. `test/e2e/helpers.js` makes the test PDF in memory (Letter page, light gray background, a 4 pt black frame at `FRAME`) and decodes the 1-bit output PNG.
- Playwright rounds mouse positions to whole CSS pixels in Firefox and WebKit. Alignment tests must compare the crop with the box position that the DOM reports, not with the target mouse position.
- Playwright supports offline service-worker tests only in Chromium. The offline test skips the other browsers.
