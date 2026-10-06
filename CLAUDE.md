# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Cropr is a client-side web app. It crops shipping labels from a PDF and prints them, or downloads them as a US Letter PNG. All processing occurs in the browser. The PDF never goes to a server.

## Commands

There is no build step and there are no npm dependencies. `package.json` only holds scripts.

```bash
npm start                                 # python3 -m http.server 8000 → http://localhost:8000
npm test                                  # node --test (all test/*.test.js)
node --test test/geometry.test.js         # one test file
node --test --test-name-pattern="resize"  # tests with a matching name
```

The app uses ES modules. A browser must load it over HTTP. `file://` does not work.

## Architecture

- `index.html` – markup, Tailwind config (custom colors `primary`, `secondary`, `accent`, `dark`), and custom CSS.
- `src/main.js` – UI wiring and state (DOM, PDF.js, pointer events, download, print).
- `src/compose.js` – draws the crop area and makes the PNG (needs the DOM).
- `src/geometry.js`, `src/image.js`, `src/png.js` – pure functions with no DOM access. Node tests cover them in `test/`. Put new pure logic here, not in `main.js`.

CDN dependencies: Tailwind (Play CDN) and PDF.js 3.4.120. PDF.js is a classic script that sets `window.pdfjsLib`. The worker URL in `src/main.js` must have the same version as the script in `index.html`.

### Data flow

1. `loadFile` → `showPage` → `renderPage`: PDF.js renders one page into `#originalCanvas` at 300 DPI (`intent: 'print'`). A render generation counter and `renderTask.cancel()` stop old renders when the user changes pages quickly.
2. A **Selection** `{x, y, w, h}` is in **fractions (0..1) of the page**. Auto mode uses `AUTO_SELECTION` (top half). Manual mode uses `state.selection`, which the user changes with `#selectionBox`.
3. `selectionToPixels` converts the Selection to bitmap pixels. `makeLabelPng` (`src/compose.js`) draws that area on a label canvas at its final size (`fitOnHalfLetter`: the top half of a 2550×3300 Letter page at 300 DPI). A portrait label (ratio > 1.2) turns 90° clockwise. Manual crops have a 60 px margin. Auto crops have no margin.
4. Black and white (default): `toMask` (threshold 160) makes a 1 = black mask. `placeMask` puts it on a white Letter page. `encodeBilevelPng` (`src/png.js`) writes a 1-bit grayscale PNG in JavaScript.
   - **Do not export the output with `canvas.toBlob`/`toDataURL`.** Safari (Advanced Fingerprinting Protection), Brave and Firefox (resistFingerprinting) add noise to canvas read-back. White becomes 250–254, and printers print that as diagonal gray streaks. The threshold removes noise that `getImageData` adds. The custom encoder keeps noise out of the file.
   - The mask must come from the **last** pixel operation. Scaling after it adds gray anti-aliased pixels again.
   - When the user turns black and white off, the output goes through `toBlob`, and it can contain this noise.
5. The PNG Blob becomes an object URL (`state.outputUrl`). `#croppedCanvas` shows the label part, as it prints.
6. Download uses `<a download>`. Print loads the PNG into a hidden `iframe` (`@page { size: Letter; margin: 0 }`) and calls `print()` on it.

### Manual selection: one coordinate space

`#selectionBox` and the four overlay `div`s are in `#cropStage`. `#cropStage` has the same size as the page canvas. The code sets their positions as **percentages**, directly from the Selection fractions. Thus the box and the crop always align, at any window size. Keep these rules:

- `#originalCanvas` must not have a border or padding, and it must fill `#cropStage` (`block w-full h-auto`).
- The selection box uses `outline`, not `border`, so the visible clear area is the crop area.
- Drag code converts pointer movement to fractions with the size of `#cropStage` at `pointerdown`. Pointer capture keeps the gesture on the box.
