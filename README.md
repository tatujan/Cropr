# Shipping Label Cropper

A tiny, client-side web app that lets you:

* **Upload** any PDF shipping label  
* **Auto-crop** the top 50 % or draw a custom crop rectangle (mouse or touch)  
* **Preview** the result at 300 dpi with a dashed cut-guide  
* **Download** a US Letter-sized PNG for printable shiping labels
* **Print** directly from the browser (single sheet, no headers/footers)

Everything is done locally in your browser; the PDF never leaves your
machine.

---

## Screenshot

![screenshot](docs/screenshot.png)

---

## Features

| Feature | Details |
|---------|---------|
| **Client-only** | No back-end, no file upload, works offline after first load. |
| **High-resolution** | Renders the PDF at 300 dpi, preserving barcode clarity. |
| **Auto vs Manual crop** | One-click top-half crop for FedEx labels, or drag/resize a rectangle to crop. |
| **Letter layout** | Cropped label is centered horizontally and pinned to the top half of an 8.5″ × 11″ canvas. |
| **Pure black & white** | On by default. Removes the light gray haze and faint marks that printers add from anti-aliased or gray pixels. |
| **Download / Print** | Instant PNG download; printing uses a hidden iframe so the current tab never reloads. |
| **Zero dependencies (besides libs)** | Vanilla JS, Tailwind CSS, PDF.js. No build step required. |

---

## Tech stack

* **Tailwind CSS** – utility-first styling  
* **PDF.js** – renders each page at high DPI  
* **Plain JavaScript** – ES modules, no framework, no build step  
* **HTML5 Canvas** – cropping and PNG generation

---

## Getting Started

The app uses ES modules, so a browser must load it over HTTP (not `file://`):

```bash
git clone https://github.com/tatujan/Cropr.git
cd Cropr
npm start        # python3 -m http.server 8000 → open http://localhost:8000
```

## Tests

The pure logic (`src/geometry.js`, `src/image.js`) has unit tests. They use the Node test runner, with no dependencies:

```bash
npm test                                  # all tests
node --test test/geometry.test.js         # one file
node --test --test-name-pattern="resize"  # tests with a matching name
```
