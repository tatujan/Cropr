/* Cropr – UI wiring. Loads a PDF, shows the crop selection, and makes the Letter PNG. */

import {
  GlobalWorkerOptions,
  PasswordException,
  RenderingCancelledException,
  getDocument,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { makeLabelPng } from './compose.js';
import {
  AUTO_SELECTION,
  DEFAULT_MANUAL_SELECTION,
  moveSelection,
  resizeSelection,
  selectionFromKey,
  selectionToPixels,
} from './geometry.js';

/** @typedef {import('./geometry.js').CropSelection} CropSelection */
/** @typedef {import('pdfjs-dist').PDFDocumentProxy} PDFDocumentProxy */
/** @typedef {import('pdfjs-dist').RenderTask} RenderTask */

const PDF_POINTS_PER_INCH = 72;
const RENDER_DPI = 300;
const MANUAL_MARGIN = 60; // 0.2 in at 300 DPI

// PDF.js runtime assets, copied to public/pdfjs/ by scripts/copy-pdfjs-assets.js
const PDFJS_ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/* ───────────── DOM ───────────── */

/**
 * @template {HTMLElement} [T=HTMLElement]
 * @param {string} id
 * @returns {T}
 */
const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return /** @type {T} */ (el);
};

const dom = {
  drop: $('dropZone'),
  file: /** @type {HTMLInputElement} */ ($('fileInput')),
  browse: $('browseBtn'),
  error: $('errorMsg'),
  progress: $('progressContainer'),
  track: $('progressTrack'),
  bar: $('progressBar'),
  pct: $('progressPercent'),
  preview: $('previewContainer'),
  empty: $('emptyPreview'),
  help: $('selectionHelp'),
  stage: $('cropStage'),
  page: /** @type {HTMLCanvasElement} */ ($('originalCanvas')),
  cropped: /** @type {HTMLCanvasElement} */ ($('croppedCanvas')),
  pageControls: $('pageControls'),
  pageInfo: $('pageInfo'),
  prev: /** @type {HTMLButtonElement} */ ($('prevPageBtn')),
  next: /** @type {HTMLButtonElement} */ ($('nextPageBtn')),
  auto: $('autoCropBtn'),
  manual: $('manualCropBtn'),
  confirm: /** @type {HTMLButtonElement} */ ($('confirmCropBtn')),
  bw: /** @type {HTMLInputElement} */ ($('bwToggle')),
  download: /** @type {HTMLButtonElement} */ ($('downloadBtn')),
  print: /** @type {HTMLButtonElement} */ ($('printBtn')),
  reset: $('resetBtn'),
  sel: $('selectionBox'),
  overlays: { top: $('ovTop'), left: $('ovLeft'), right: $('ovRight'), bottom: $('ovBottom') },
};

/* ───────────── State ───────────── */
const state = {
  /** @type {PDFDocumentProxy | null} */
  pdf: null,
  pageNum: 1,
  /** @type {RenderTask | null} */
  renderTask: null,
  renderGen: 0, // newest page render; older renders stop when they see a newer value
  /** @type {'auto' | 'manual'} */
  mode: 'auto',
  editing: false, // true while the user moves the manual selection
  /** @type {CropSelection} */
  selection: { ...DEFAULT_MANUAL_SELECTION },
  /** @type {string | null} object URL of the Letter PNG */
  outputUrl: null,
  outputGen: 0,
};

/* ───────────── Small UI helpers ───────────── */

/** @param {HTMLElement} el @param {boolean} visible */
const show = (el, visible) => el.classList.toggle('hidden', !visible);

/** @param {number} pct */
function setProgress(pct) {
  const value = Math.round(pct);
  dom.bar.style.width = `${pct}%`;
  dom.pct.textContent = `${value} %`;
  dom.track.setAttribute('aria-valuenow', String(value));
}

/** @param {string} message empty string hides the message */
function showError(message) {
  dom.error.textContent = message;
  show(dom.error, Boolean(message));
}

/** @param {HTMLElement} btn @param {boolean} active */
function setActive(btn, active) {
  btn.setAttribute('aria-pressed', String(active));
  btn.classList.toggle('bg-primary', active);
  btn.classList.toggle('hover:bg-emerald-600', active);
  btn.classList.toggle('text-white', active);
  btn.classList.toggle('bg-gray-300', !active);
  btn.classList.toggle('hover:bg-gray-400', !active);
  btn.classList.toggle('text-gray-700', !active);
}

/* ───────────── Selection box ───────────── */
function drawSelection() {
  const { x, y, w, h } = state.selection;
  /** @param {number} v */
  const pct = (v) => `${v * 100}%`;
  Object.assign(dom.sel.style, { left: pct(x), top: pct(y), width: pct(w), height: pct(h) });
  Object.assign(dom.overlays.top.style, { left: '0', top: '0', width: '100%', height: pct(y) });
  Object.assign(dom.overlays.bottom.style, {
    left: '0',
    top: pct(y + h),
    width: '100%',
    height: pct(1 - y - h),
  });
  Object.assign(dom.overlays.left.style, { left: '0', top: pct(y), width: pct(x), height: pct(h) });
  Object.assign(dom.overlays.right.style, {
    left: pct(x + w),
    top: pct(y),
    width: pct(1 - x - w),
    height: pct(h),
  });
  dom.sel.setAttribute(
    'aria-label',
    `Crop selection: left ${Math.round(x * 100)}%, top ${Math.round(y * 100)}%, ` +
      `width ${Math.round(w * 100)}%, height ${Math.round(h * 100)}%`,
  );
}

/** @param {boolean} editing */
function setEditing(editing) {
  state.editing = editing;
  dom.sel.hidden = !editing;
  dom.help.hidden = !editing;
  Object.values(dom.overlays).forEach((o) => {
    o.hidden = !editing;
  });
  dom.confirm.disabled = !editing;
  if (editing) drawSelection();
}

// Pointer events cover mouse, touch and pen. Pointer capture keeps the gesture
// on the box when the pointer moves fast and goes out of it.
/** @type {{handle: string | null, x0: number, y0: number, width: number, height: number, start: CropSelection} | null} */
let gesture = null;

dom.sel.addEventListener('pointerdown', (e) => {
  if (!state.editing || e.button !== 0) return;
  e.preventDefault();
  dom.sel.focus({ preventScroll: true });
  const rect = dom.stage.getBoundingClientRect();
  gesture = {
    handle: /** @type {HTMLElement} */ (e.target).dataset.handle ?? null,
    x0: e.clientX,
    y0: e.clientY,
    width: rect.width,
    height: rect.height,
    start: { ...state.selection },
  };
  dom.sel.setPointerCapture(e.pointerId);
});

dom.sel.addEventListener('pointermove', (e) => {
  if (!gesture) return;
  const dx = (e.clientX - gesture.x0) / gesture.width;
  const dy = (e.clientY - gesture.y0) / gesture.height;
  state.selection = gesture.handle
    ? resizeSelection(gesture.start, gesture.handle, dx, dy)
    : moveSelection(gesture.start, dx, dy);
  drawSelection();
});

const endGesture = () => {
  gesture = null;
};
dom.sel.addEventListener('pointerup', endGesture);
dom.sel.addEventListener('pointercancel', endGesture);

dom.sel.addEventListener('keydown', (e) => {
  if (!state.editing) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    confirmSelection();
    return;
  }
  const next = selectionFromKey(state.selection, e.key, { resize: e.shiftKey, fine: e.altKey });
  if (!next) return;
  e.preventDefault();
  state.selection = next;
  drawSelection();
});

/* ───────────── Output (Letter PNG) ───────────── */
function clearOutput() {
  state.outputGen += 1;
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
  state.outputUrl = null;
  dom.download.disabled = dom.print.disabled = true;
}

/** @param {CropSelection} selection @param {number} margin */
async function makeOutput(selection, margin) {
  clearOutput();
  const gen = state.outputGen;

  const rect = selectionToPixels(selection, dom.page.width, dom.page.height);
  let result;
  try {
    result = await makeLabelPng(dom.page, rect, { margin, blackAndWhite: dom.bw.checked });
  } catch (err) {
    console.error(err);
    if (gen === state.outputGen) showError('Could not make the PNG.');
    return;
  }
  if (gen !== state.outputGen) return; // a newer output replaced this one

  // The preview shows the label part of the page, as it will print.
  const { blob, preview } = result;
  dom.cropped.width = preview.width;
  dom.cropped.height = preview.height;
  dom.cropped.getContext('2d')?.drawImage(preview, 0, 0);

  state.outputUrl = URL.createObjectURL(blob);
  dom.download.disabled = dom.print.disabled = false;
}

/** Make the output again for the current mode. Manual mode waits for "Confirm Selection". */
function refreshOutput() {
  if (state.mode === 'auto') {
    setEditing(false);
    makeOutput(AUTO_SELECTION, 0);
  } else {
    clearOutput();
    setEditing(true);
  }
}

/** @param {'auto' | 'manual'} mode */
function setMode(mode) {
  state.mode = mode;
  setActive(dom.auto, mode === 'auto');
  setActive(dom.manual, mode === 'manual');
  refreshOutput();
  if (mode === 'manual' && state.pdf) dom.sel.focus({ preventScroll: true });
}

function confirmSelection() {
  if (!state.editing) return;
  setEditing(false);
  makeOutput(state.selection, MANUAL_MARGIN);
  dom.download.focus({ preventScroll: true });
}

/* ───────────── PDF loading and rendering ───────────── */

/** @param {File} file */
const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/**
 * Render a page into the page canvas.
 * @param {PDFDocumentProxy} pdf
 * @param {number} pageNum
 * @returns {Promise<boolean>} false if a newer render replaced this one
 */
async function renderPage(pdf, pageNum) {
  const gen = ++state.renderGen;
  state.renderTask?.cancel();

  const page = await pdf.getPage(pageNum);
  if (gen !== state.renderGen) return false;

  const viewport = page.getViewport({ scale: RENDER_DPI / PDF_POINTS_PER_INCH });
  dom.page.width = Math.floor(viewport.width);
  dom.page.height = Math.floor(viewport.height);

  const task = page.render({ canvas: dom.page, viewport, intent: 'print' });
  state.renderTask = task;
  try {
    await task.promise;
  } catch (err) {
    if (err instanceof RenderingCancelledException) return false;
    throw err;
  } finally {
    if (state.renderTask === task) state.renderTask = null;
  }
  return gen === state.renderGen;
}

/** @param {number} pageNum */
async function showPage(pageNum) {
  const { pdf } = state;
  if (!pdf) return;
  state.pageNum = pageNum;
  dom.pageInfo.textContent = `Page ${pageNum} of ${pdf.numPages}`;
  dom.prev.disabled = pageNum <= 1;
  dom.next.disabled = pageNum >= pdf.numPages;

  clearOutput();
  try {
    if (await renderPage(pdf, pageNum)) refreshOutput();
  } catch (err) {
    console.error(err);
    showError(`Could not show page ${pageNum}.`);
  }
}

/** @param {File | undefined} file */
async function loadFile(file) {
  if (!file) return;
  if (!isPdf(file)) {
    showError('Please choose a PDF file.');
    return;
  }

  showError('');
  show(dom.progress, true);
  setProgress(0);
  try {
    const task = getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      wasmUrl: `${PDFJS_ASSETS}wasm/`,
      standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
      cMapUrl: `${PDFJS_ASSETS}cmaps/`,
      iccUrl: `${PDFJS_ASSETS}iccs/`,
      enableXfa: false,
    });
    task.onProgress = (/** @type {{loaded: number, total: number}} */ { loaded, total }) => {
      if (total) setProgress((loaded / total) * 50);
    };
    const pdf = await task.promise;

    void state.pdf?.loadingTask.destroy();
    state.pdf = pdf;
    setProgress(50);

    show(dom.pageControls, pdf.numPages > 1);
    show(dom.preview, true);
    show(dom.empty, false);
    await showPage(1);
    setProgress(100);
  } catch (err) {
    console.error(err);
    showError(
      err instanceof PasswordException
        ? 'This PDF is protected with a password. Please use a PDF without a password.'
        : 'Could not read this PDF. The file can be damaged.',
    );
  } finally {
    setTimeout(() => show(dom.progress, false), 400);
    dom.file.value = ''; // so that the same file can be chosen again
  }
}

function reset() {
  state.renderGen += 1;
  state.renderTask?.cancel();
  void state.pdf?.loadingTask.destroy();
  state.pdf = null;
  state.selection = { ...DEFAULT_MANUAL_SELECTION };
  dom.file.value = '';
  showError('');
  show(dom.preview, false);
  show(dom.pageControls, false);
  show(dom.empty, true);
  state.mode = 'auto';
  setActive(dom.auto, true);
  setActive(dom.manual, false);
  setEditing(false);
  clearOutput();
  dom.browse.focus();
}

/* ───────────── Download and print ───────────── */
function download() {
  if (!state.outputUrl) return;
  const a = document.createElement('a');
  a.href = state.outputUrl;
  a.download = 'shipping-label.png';
  a.click();
}

// Print from a hidden same-origin frame (print.html), so the app page does not
// change. print.html has no inline styles, so the CSP stays strict.
function print() {
  const url = state.outputUrl;
  if (!url) return;
  document.querySelectorAll('iframe.print-frame').forEach((f) => f.remove());

  const iframe = document.createElement('iframe');
  iframe.className = 'print-frame';
  iframe.title = 'Print';
  iframe.addEventListener(
    'load',
    () => {
      const win = iframe.contentWindow;
      const img = /** @type {HTMLImageElement | null} */ (
        iframe.contentDocument?.getElementById('label')
      );
      if (!win || !img) return;
      img.addEventListener(
        'load',
        () => {
          win.addEventListener('afterprint', () => iframe.remove(), { once: true });
          win.focus();
          win.print();
        },
        { once: true },
      );
      img.src = url;
    },
    { once: true },
  );
  iframe.src = `${import.meta.env.BASE_URL}print.html`;
  document.body.append(iframe);
}

/* ───────────── Event wiring ───────────── */
dom.browse.addEventListener('click', () => dom.file.click());
dom.drop.addEventListener('click', (e) => {
  // A click anywhere in the drop zone opens the file dialog. The button and the
  // input do this already (dom.file.click() also sends a click to here).
  if (e.target === dom.file || dom.browse.contains(/** @type {Node} */ (e.target))) return;
  dom.file.click();
});
dom.file.addEventListener('change', () => loadFile(dom.file.files?.[0]));

for (const type of ['dragenter', 'dragover']) {
  dom.drop.addEventListener(type, (e) => {
    e.preventDefault();
    dom.drop.classList.add('active');
  });
}
for (const type of ['dragleave', 'dragend', 'drop']) {
  dom.drop.addEventListener(type, (e) => {
    e.preventDefault();
    dom.drop.classList.remove('active');
  });
}
dom.drop.addEventListener('drop', (e) => loadFile(e.dataTransfer?.files[0]));
// A file dropped outside the drop zone must not open in the browser tab.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (e) => e.preventDefault());
}

dom.auto.addEventListener('click', () => setMode('auto'));
dom.manual.addEventListener('click', () => setMode('manual'));
dom.confirm.addEventListener('click', confirmSelection);
dom.bw.addEventListener('change', () => {
  if (!state.pdf || state.editing) return;
  if (state.mode === 'auto') makeOutput(AUTO_SELECTION, 0);
  else makeOutput(state.selection, MANUAL_MARGIN);
});

dom.download.addEventListener('click', download);
dom.print.addEventListener('click', print);
dom.reset.addEventListener('click', reset);

dom.prev.addEventListener('click', () => showPage(state.pageNum - 1));
dom.next.addEventListener('click', () => showPage(state.pageNum + 1));
