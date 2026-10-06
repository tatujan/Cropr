# Cropr – Shipping Label Cropper

A small, free web app that crops PDF shipping labels (FedEx, UPS, USPS, store exports) and
prints them on 4×6 thermal or US Letter paper. Everything runs locally in your browser; the PDF
never leaves your computer.

---

## Screenshot

![screenshot](docs/screenshot.png)

---

## Features

| Feature                 | Details                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client-only**         | No back-end, no account, no upload. Installable, and works offline after the first visit (service worker).                                      |
| **Auto crop**           | Takes the top half of a Letter/A4/Legal page (or the whole page of a label-size PDF) and trims the white space around the label.                |
| **Manual crop**         | Drag or resize a box (mouse, touch or keyboard: arrow keys move, Shift + arrow keys resize, Enter applies). One crop applies to all pages.      |
| **Multi-page PDFs**     | A page strip shows every page. Choose which pages to print; print or download them all in one step (more than one PNG downloads as a ZIP file). |
| **4×6 or Letter**       | Labels print at true size, 300 DPI. They turn 90° when that fits better, and you can rotate them. On Letter, the label goes in the top half.    |
| **Pure black & white**  | On by default. Writes 1-bit PNGs, so no gray haze, and no streaks from browser canvas noise (Safari, Brave, Firefox fingerprinting protection). |
| **Day / Dark / System** | Theme toggle in the header. Your theme and paper choices are saved in your browser.                                                             |
| **Strict security**     | All code and fonts are served from the app's own origin. A strict Content-Security-Policy and other security headers are set in `vercel.json`.  |

---

## Tech stack

- **Vite** – dev server and production build
- **PDF.js** (`pdfjs-dist`) – renders each page at high DPI, in a web worker
- **Plain CSS** – the Cropr design system (tokens and components) in `src/styles.css`; see `docs/design-system.md`
- **Geist** and **Geist Mono** fonts, self-hosted
- **Plain JavaScript** – ES modules with JSDoc types (checked by TypeScript), no framework
- **vite-plugin-pwa** – service worker for offline use
- **Vitest** (unit) and **Playwright** (Chromium, Firefox, WebKit) for tests

---

## Getting started

Requires Node.js 22 or later (see `.nvmrc`).

```bash
git clone https://github.com/tatujan/Cropr.git
cd Cropr
npm install
npm run dev        # http://localhost:5173
```

| Command            | What it does                                             |
| ------------------ | -------------------------------------------------------- |
| `npm run dev`      | Dev server with hot reload                               |
| `npm run build`    | Production build in `dist/`                              |
| `npm run preview`  | Serve `dist/` with the production security headers       |
| `npm run check`    | Lint, format check, type check and unit tests (as in CI) |
| `npm test`         | Unit tests (Vitest)                                      |
| `npm run test:e2e` | Browser tests (Playwright) against the production build  |
| `npm run format`   | Format all files with Prettier                           |

Run one unit test file with `npx vitest run test/unit/png.test.js`, or one browser test with
`npx playwright test -g "keyboard" --project=chromium`. Before the first browser test run,
install the browsers with `npx playwright install`.

## Deployment

Vercel builds the app with `npm run build` and serves `dist/`. `vercel.json` sets the security
headers. GitHub Actions (`.github/workflows/ci.yml`) runs all checks and the browser tests on each
push and pull request.
