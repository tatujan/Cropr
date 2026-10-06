# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Cropr is a client-side web app. It crops shipping labels from a PDF (one or more pages) and prints them on 4×6 or US Letter paper, or downloads them as PNG files. All processing occurs in the browser. The PDF never goes to a server. It is deployed on Vercel (`cropr.vercel.app`).

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

- `index.html` – markup with ARIA attributes. No inline scripts or styles, because the CSP blocks them.
- `print.html` + `src/print.css` – the page that the hidden print frame loads. `main.js` adds the `@page` size rule and one `<img>` for each label.
- `src/main.js` – UI wiring and state (DOM, PDF.js, page strip, crop modes, output settings, theme, download, print).
- `src/compose.js` – auto-crop trim and PNG making (needs the DOM).
- `src/geometry.js`, `src/image.js`, `src/png.js`, `src/zip.js` – pure functions with no DOM access. Vitest covers them. Put new pure logic here, not in `main.js`.
- `src/styles.css` – the design system: tokens and one class for each component. No CSS framework.
- `public/theme-init.js` – sets `data-theme` before the first paint.

### Design system

`docs/design-system.md` is the design guide (direction 2a "Clean"): voice and copy rules, tokens, components, and the list of places where the app differs from the design package on purpose. Read it before UI work. Rules that are easy to break:

- Use the tokens (`var(--accent)`, `var(--surface)`, …) for all colors. Every color must work in Day and Dark. Paper and label previews stay white (`--paper`) in both themes.
- One accent color (green). Red only for errors. No gradients, no shadows on UI (only on paper), no emoji.
- Sentence case. Buttons are a verb first, 1–3 words. Do not write that Cropr "detects" or "finds" labels: auto crop takes the top half (or whole label-size page) and trims white space.
- Themes: `[data-theme="light"|"dark"]` on `<html>`, or no attribute = System (`prefers-color-scheme`).
- Fonts are self-hosted (`Geist Variable`, `Geist Mono Variable`). Do not load fonts or anything else from Google or a CDN.
- `vercel.json` – the one source of the security headers. `vite.config.js` reads it and applies the same headers to `vite preview`, so the Playwright tests run under the production CSP. Exception: the preview server drops `Cross-Origin-Opener-Policy`, because it makes Playwright's Firefox hang on `page.goto` in about 1 of 25 runs.

All code is JavaScript with JSDoc types. `npm run typecheck` runs TypeScript 7 in strict `checkJs` mode. With TypeScript 7, a `@typedef` must be directly above a declaration. Do not name a type `Selection` (it clashes with the DOM type). The crop type is `CropSelection`.

### Data flow

1. `loadFile` → `showPage`: PDF.js renders the current page into `#originalCanvas` at 300 DPI (`intent: 'print'`). A render generation counter and `renderTask.cancel()` stop old renders when the user changes pages quickly. Page strip thumbnails render after the first page, one at a time. Free a document with `pdf.loadingTask.destroy()` (PDF.js 6 has no `PDFDocumentProxy.destroy`).
2. **Auto crop:** `autoCropArea` gives the top half of a page taller than 9 in, else the whole page. `autoCropRect` (`compose.js`) makes it smaller to the dark content (`contentBounds` + `trimRect`, 15 px padding).
3. **Manual crop:** a **CropSelection** `{x, y, w, h}` in **fractions (0..1) of the page**. The user changes `state.draft` (pointer or keyboard, `selectionFromKey`); Apply crop copies it to `state.manual`, which applies to **all pages**. `selectionToPixels` converts it to bitmap pixels. Print and download are disabled while the user edits.
4. `makeLabelPng` draws the crop on a label canvas at its final size. `fitOnPaper` picks the place on the paper (`PAPERS`: Letter = top half of 2550×3300, 4×6 = 1200×1800): scale ≤ 1 (true size, never larger), a 90° turn when that fits better, plus the user's rotation (`state.turn`).
5. Black and white (default): `toMask` (threshold 160) makes a 1 = black mask. `placeMask` puts it on a white paper-size mask. `encodeBilevelPng` (`src/png.js`) writes a 1-bit grayscale PNG in JavaScript.
   - **Do not export the output with `canvas.toBlob`/`toDataURL`.** Safari (Advanced Fingerprinting Protection), Brave and Firefox (resistFingerprinting) add noise to canvas read-back. White becomes 250–254, and printers print that as diagonal gray streaks. The threshold removes noise that `getImageData` adds. The custom encoder keeps noise out of the file. The e2e test "canvas read-back noise does not reach the PNG" simulates this noise.
   - The mask must come from the **last** pixel operation. Scaling after it adds gray anti-aliased pixels again.
   - When the user turns black and white off, the output goes through `toBlob`, and it can contain this noise.
6. The PNG of the current page is `state.output`. `#croppedCanvas` shows the whole paper at small size, as it prints.
7. Print and download use `buildLabels`: the current page's PNG, plus the other included pages, rendered one at a time (one extra 300 DPI bitmap in memory). One label downloads as `shipping-label.png`; more labels download as `shipping-labels.zip` (`storeZip`). Print loads `print.html` in a hidden same-origin frame, adds the `@page` size rule through CSSOM and the images, and calls `print()` on the frame.

### Manual selection: one coordinate space

`#selectionBox` and the four overlay `div`s are in `#cropStage`. `#cropStage` has the same size as the page canvas. The code sets their positions as **percentages**, directly from the selection fractions. Thus the box and the crop always align, at any window size. Keep these rules:

- `#originalCanvas` must not have a border or padding, and it must fill `#cropStage` (`display: block; width: 100%; height: auto`).
- The selection box uses `outline`, not `border`, so the visible clear area is the crop area.
- Drag code converts pointer movement to fractions with the size of `#cropStage` at `pointerdown`. Pointer capture keeps the gesture on the box.

### Constraints from the CSP and the service worker

- The CSP is `script-src 'self' 'wasm-unsafe-eval'; style-src 'self'`. Do not add inline `<script>`, `<style>`, `style="…"` attributes, or third-party origins. Setting `element.style` from JavaScript is allowed.
- `vite-plugin-pwa` precaches the app shell, the Geist fonts, the PDF.js worker, wasm and standard fonts (`workbox.globPatterns` in `vite.config.js`). CMaps are cached at runtime. A new asset type must be in `globPatterns` to work offline.

### Tests

- Unit tests: `test/unit/`. Browser tests: `test/e2e/`. `test/e2e/helpers.js` makes the test PDF in memory (Letter pages, light gray background, a black frame at `FRAME` with line width `FRAME_LINE`), decodes the 1-bit output PNG, and reads the ZIP.
- Playwright rounds mouse positions to whole CSS pixels in Firefox and WebKit. Alignment tests must compare the crop with the box position that the DOM reports, not with the target mouse position. At narrow widths one CSS pixel is about 7 page pixels, so the frame line must be thick (8 pt) for the box edge to land on it.
- Playwright supports offline service-worker tests only in Chromium. The offline test skips the other browsers.
