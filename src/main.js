/* Cropr – UI wiring. Loads a PDF, shows the crop selection, and makes the Letter PNG. */

import {
  AUTO_SELECTION,
  DEFAULT_MANUAL_SELECTION,
  moveSelection,
  resizeSelection,
  selectionToPixels,
} from './geometry.js';
import { makeLabelPng } from './compose.js';

const PDF_POINTS_PER_INCH = 72;
const RENDER_DPI = 300;
const MANUAL_MARGIN = 60; // 0.2 in at 300 DPI
const PDFJS_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

const { pdfjsLib } = window;
pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

/* ───────────── DOM ───────────── */
const $ = (id) => document.getElementById(id);
const dom = {
  drop: $('dropZone'), file: $('fileInput'), browse: $('browseBtn'), error: $('errorMsg'),
  progress: $('progressContainer'), bar: $('progressBar'), pct: $('progressPercent'),
  preview: $('previewContainer'), empty: $('emptyPreview'),
  stage: $('cropStage'), page: $('originalCanvas'), cropped: $('croppedCanvas'),
  pageControls: $('pageControls'), pageInfo: $('pageInfo'), prev: $('prevPageBtn'), next: $('nextPageBtn'),
  auto: $('autoCropBtn'), manual: $('manualCropBtn'), confirm: $('confirmCropBtn'), bw: $('bwToggle'),
  download: $('downloadBtn'), print: $('printBtn'), reset: $('resetBtn'),
  sel: $('selectionBox'),
  overlays: {
    top: $('ovTop'), left: $('ovLeft'), right: $('ovRight'), bottom: $('ovBottom'),
  },
};

/* ───────────── State ───────────── */
const state = {
  pdf: null,
  pageNum: 1,
  renderTask: null,
  renderGen: 0,      // newest page render; older renders stop when they see a newer value
  mode: 'auto',      // 'auto' | 'manual'
  editing: false,    // true while the user moves the manual selection
  selection: { ...DEFAULT_MANUAL_SELECTION },
  outputUrl: null,   // object URL of the Letter PNG
  outputGen: 0,
};

/* ───────────── Small UI helpers ───────────── */
const show = (el, visible) => el.classList.toggle('hidden', !visible);

function setProgress(pct) {
  dom.bar.style.width = `${pct}%`;
  dom.pct.textContent = `${Math.round(pct)} %`;
}

function showError(message) {
  dom.error.textContent = message;
  show(dom.error, Boolean(message));
}

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
  const pct = (v) => `${v * 100}%`;
  Object.assign(dom.sel.style, { left: pct(x), top: pct(y), width: pct(w), height: pct(h) });
  Object.assign(dom.overlays.top.style, { left: '0', top: '0', width: '100%', height: pct(y) });
  Object.assign(dom.overlays.bottom.style, { left: '0', top: pct(y + h), width: '100%', height: pct(1 - y - h) });
  Object.assign(dom.overlays.left.style, { left: '0', top: pct(y), width: pct(x), height: pct(h) });
  Object.assign(dom.overlays.right.style, { left: pct(x + w), top: pct(y), width: pct(1 - x - w), height: pct(h) });
}

function setEditing(editing) {
  state.editing = editing;
  dom.sel.hidden = !editing;
  Object.values(dom.overlays).forEach((o) => { o.hidden = !editing; });
  dom.confirm.disabled = !editing;
  if (editing) drawSelection();
}

// Pointer events cover mouse, touch and pen. Pointer capture keeps the gesture
// on the box when the pointer moves fast and goes out of it.
let gesture = null;

dom.sel.addEventListener('pointerdown', (e) => {
  if (!state.editing || e.button !== 0) return;
  e.preventDefault();
  const rect = dom.stage.getBoundingClientRect();
  gesture = {
    handle: e.target.dataset.handle ?? null,
    x0: e.clientX, y0: e.clientY,
    width: rect.width, height: rect.height,
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

const endGesture = () => { gesture = null; };
dom.sel.addEventListener('pointerup', endGesture);
dom.sel.addEventListener('pointercancel', endGesture);

/* ───────────── Output (Letter PNG) ───────────── */
function clearOutput() {
  state.outputGen += 1;
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
  state.outputUrl = null;
  dom.download.disabled = dom.print.disabled = true;
}

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
  dom.cropped.getContext('2d').drawImage(preview, 0, 0);

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

function setMode(mode) {
  state.mode = mode;
  setActive(dom.auto, mode === 'auto');
  setActive(dom.manual, mode === 'manual');
  refreshOutput();
}

/* ───────────── PDF loading and rendering ───────────── */
const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** Render a page into the page canvas. Returns false if a newer render replaced it. */
async function renderPage(pageNum) {
  const gen = ++state.renderGen;
  state.renderTask?.cancel();

  const page = await state.pdf.getPage(pageNum);
  if (gen !== state.renderGen) return false;

  const viewport = page.getViewport({ scale: RENDER_DPI / PDF_POINTS_PER_INCH });
  dom.page.width = Math.floor(viewport.width);
  dom.page.height = Math.floor(viewport.height);

  const task = page.render({
    canvasContext: dom.page.getContext('2d', { willReadFrequently: true }),
    viewport,
    intent: 'print',
  });
  state.renderTask = task;
  try {
    await task.promise;
  } catch (err) {
    if (err?.name === 'RenderingCancelledException') return false;
    throw err;
  } finally {
    if (state.renderTask === task) state.renderTask = null;
  }
  return gen === state.renderGen;
}

async function showPage(pageNum) {
  state.pageNum = pageNum;
  dom.pageInfo.textContent = `Page ${pageNum} of ${state.pdf.numPages}`;
  dom.prev.disabled = pageNum <= 1;
  dom.next.disabled = pageNum >= state.pdf.numPages;

  clearOutput();
  try {
    if (await renderPage(pageNum)) refreshOutput();
  } catch (err) {
    console.error(err);
    showError(`Could not show page ${pageNum}.`);
  }
}

async function loadFile(file) {
  if (!file) return;
  if (!isPdf(file)) { showError('Please choose a PDF file.'); return; }

  showError('');
  show(dom.progress, true);
  setProgress(0);
  try {
    const task = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    task.onProgress = ({ loaded, total }) => { if (total) setProgress((loaded / total) * 50); };
    const pdf = await task.promise;

    await state.pdf?.destroy();
    state.pdf = pdf;
    setProgress(50);

    show(dom.pageControls, pdf.numPages > 1);
    show(dom.preview, true);
    show(dom.empty, false);
    await showPage(1);
    setProgress(100);
  } catch (err) {
    console.error(err);
    showError('Could not read this PDF. The file can be damaged or protected with a password.');
  } finally {
    setTimeout(() => show(dom.progress, false), 400);
  }
}

function reset() {
  state.renderGen += 1;
  state.renderTask?.cancel();
  state.pdf?.destroy();
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
}

/* ───────────── Download and print ───────────── */
function download() {
  if (!state.outputUrl) return;
  const a = document.createElement('a');
  a.href = state.outputUrl;
  a.download = 'shipping-label.png';
  a.click();
}

// Print from a hidden iframe, so the app page does not change.
function print() {
  if (!state.outputUrl) return;
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: Letter; margin: 0; }
      html, body { margin: 0; }
      img { display: block; width: 100%; height: auto; }
    </style></head><body><img src="${state.outputUrl}" alt=""></body></html>`;
  iframe.onload = () => {
    const win = iframe.contentWindow;
    win.addEventListener('afterprint', () => iframe.remove());
    win.focus();
    win.print();
  };
  document.body.appendChild(iframe);
}

/* ───────────── Event wiring ───────────── */
dom.browse.addEventListener('click', () => dom.file.click());
dom.file.addEventListener('change', (e) => loadFile(e.target.files[0]));

['dragenter', 'dragover'].forEach((type) => dom.drop.addEventListener(type, (e) => {
  e.preventDefault();
  dom.drop.classList.add('active');
}));
['dragleave', 'dragend', 'drop'].forEach((type) => dom.drop.addEventListener(type, (e) => {
  e.preventDefault();
  dom.drop.classList.remove('active');
}));
dom.drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

dom.auto.addEventListener('click', () => setMode('auto'));
dom.manual.addEventListener('click', () => setMode('manual'));
dom.confirm.addEventListener('click', () => {
  if (!state.editing) return;
  setEditing(false);
  makeOutput(state.selection, MANUAL_MARGIN);
});
dom.bw.addEventListener('change', () => {
  if (state.pdf && !state.editing) {
    if (state.mode === 'auto') makeOutput(AUTO_SELECTION, 0);
    else makeOutput(state.selection, MANUAL_MARGIN);
  }
});

dom.download.addEventListener('click', download);
dom.print.addEventListener('click', print);
dom.reset.addEventListener('click', reset);

dom.prev.addEventListener('click', () => showPage(state.pageNum - 1));
dom.next.addEventListener('click', () => showPage(state.pageNum + 1));
