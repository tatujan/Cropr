/* Cropr – UI wiring. Loads a PDF, shows the crop, and makes the label PNGs. */

import {
  GlobalWorkerOptions,
  PasswordException,
  RenderingCancelledException,
  getDocument,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { autoCropRect, context2d, makeLabelPng } from './compose.js';
import {
  DPI,
  PAPERS,
  autoCropArea,
  moveSelection,
  resizeSelection,
  selectionFromKey,
  selectionToPixels,
} from './geometry.js';
import { storeZip } from './zip.js';

/** @typedef {import('./geometry.js').CropSelection} CropSelection */
/** @typedef {import('./geometry.js').PixelRect} PixelRect */
/** @typedef {import('./geometry.js').PaperKey} PaperKey */
/** @typedef {import('./geometry.js').Rotation} Rotation */
/** @typedef {import('pdfjs-dist').PDFDocumentProxy} PDFDocumentProxy */
/** @typedef {import('pdfjs-dist').PDFPageProxy} PDFPageProxy */
/** @typedef {import('pdfjs-dist').RenderTask} RenderTask */

const RENDER_SCALE = DPI / 72; // PDF points → 300 DPI pixels
const THUMB_PIXELS = 96; // page strip thumbnail width (2× its 48 px CSS width)
const PREVIEW_PIXELS = { letter: 560, '4x6': 480 }; // output preview width (2× CSS width)

// PDF.js runtime assets, copied to public/pdfjs/ by scripts/copy-pdfjs-assets.js
const PDFJS_ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/* ───────────── Saved preferences (localStorage can be blocked) ───────────── */
const storage = {
  /** @param {string} key */
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /** @param {string} key @param {string | null} value */
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Not saved; the choice still applies for this visit.
    }
  },
};

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
/** @param {string} id */
const $button = (id) => /** @type {HTMLButtonElement} */ ($(id));
/** @param {string} id */
const $canvas = (id) => /** @type {HTMLCanvasElement} */ ($(id));

const dom = {
  hero: $('hero'),
  drop: $('dropZone'),
  heroNotes: $('heroNotes'),
  file: /** @type {HTMLInputElement} */ ($('fileInput')),
  browse: $button('browseBtn'),
  progress: $('progressContainer'),
  track: $('progressTrack'),
  bar: $('progressBar'),
  error: $('errorAlert'),
  errorTitle: $('errorTitle'),
  errorText: $('errorText'),
  errorDismiss: $button('errorDismiss'),

  workspace: $('workspace'),
  fileName: $('fileName'),
  fileMeta: $('fileMeta'),
  replace: $button('replaceBtn'),
  stripSection: $('pageStripSection'),
  strip: $('pageStrip'),
  pageCount: $('pageCount'),
  modeGroup: /** @type {HTMLElement} */ ($('autoCropBtn').parentElement),
  auto: $button('autoCropBtn'),
  manual: $button('manualCropBtn'),
  cropStatus: $('cropStatus'),
  stage: $('cropStage'),
  page: $canvas('originalCanvas'),
  sel: $('selectionBox'),
  tag: $('cropTag'),
  overlays: { top: $('ovTop'), left: $('ovLeft'), right: $('ovRight'), bottom: $('ovBottom') },
  help: $('cropHelp'),
  cancel: $button('cancelCropBtn'),
  apply: $button('confirmCropBtn'),
  edit: $button('editCropBtn'),

  output: $('output'),
  outputCount: $('outputCount'),
  preview: $canvas('croppedCanvas'),
  outputMeta: $('outputMeta'),
  paperGroup: /** @type {HTMLElement} */ (document.querySelector('.paper-options')),
  rotateLeft: $button('rotateLeftBtn'),
  rotateRight: $button('rotateRightBtn'),
  bw: $button('bwToggle'),
  print: $button('printBtn'),
  printLabel: $('printLabel'),
  download: $button('downloadBtn'),
  downloadLabel: $('downloadLabel'),
  reset: $button('resetBtn'),

  themeGroup: /** @type {HTMLElement} */ (document.querySelector('.theme-toggle')),
};

/* ───────────── State ───────────── */
const savedPaper = storage.get('cropr-paper');

const state = {
  /** @type {PDFDocumentProxy | null} */
  pdf: null,
  pageNum: 1,
  /** @type {boolean[]} pages to print (index 0 = page 1) */
  included: [],
  /** @type {RenderTask | null} */
  renderTask: null,
  renderGen: 0, // newest page render; older async work stops when it sees a newer value
  /** Current page size in PDF points */
  pageSize: { width: 0, height: 0 },
  /** @type {PixelRect | null} auto crop of the current page */
  autoRect: null,
  /** @type {'top-half' | 'whole-page'} */
  autoKind: 'top-half',

  /** @type {'auto' | 'manual'} */
  mode: 'auto',
  /** @type {CropSelection | null} applied manual crop (all pages) */
  manual: null,
  editing: false,
  /** @type {CropSelection} the box while the user changes it */
  draft: { x: 0.1, y: 0.1, w: 0.8, h: 0.4 },

  /** @type {PaperKey} */
  paper: savedPaper === 'letter' || savedPaper === '4x6' ? savedPaper : '4x6',
  /** @type {Rotation} the user's rotation */
  turn: 0,
  blackAndWhite: true,

  /** @type {{url: string, blob: Blob} | null} PNG of the current page */
  output: null,
  outputGen: 0,
  busy: false,
};

/* ───────────── Small helpers ───────────── */
const pageCount = () => state.pdf?.numPages ?? 0;
const includedPages = () =>
  state.included.flatMap((on, i) => (on ? [i + 1] : /** @type {number[]} */ ([])));

/** @param {number} pct */
function setProgress(pct) {
  dom.bar.style.width = `${pct}%`;
  dom.track.setAttribute('aria-valuenow', String(Math.round(pct)));
}

/** @param {string} title @param {string} text */
function showError(title, text) {
  dom.errorTitle.textContent = title;
  dom.errorText.textContent = text;
  dom.error.hidden = false;
}
function hideError() {
  dom.error.hidden = true;
}

/** @param {number} bytes */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** @param {PixelRect} rect @param {HTMLCanvasElement} canvas @returns {CropSelection} */
const rectToSelection = (rect, canvas) => ({
  x: rect.sx / canvas.width,
  y: rect.sy / canvas.height,
  w: rect.sw / canvas.width,
  h: rect.sh / canvas.height,
});

/**
 * @param {HTMLElement} group
 * @param {(b: HTMLButtonElement) => boolean} isOn
 */
function setChecked(group, isOn) {
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (
    group.querySelectorAll('[role="radio"]')
  )) {
    const on = isOn(b);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1; // one tab stop for the group
  }
}

/**
 * Radio groups (segmented control, paper options, theme toggle): one tab stop,
 * arrow keys move the choice, as the ARIA radio group pattern says.
 * @param {HTMLElement} group
 * @param {(button: HTMLButtonElement) => void} onSelect
 */
function radioGroup(group, onSelect) {
  group.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[role="radio"]');
    if (b instanceof HTMLButtonElement && !b.disabled) onSelect(b);
  });
  group.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const list = /** @type {HTMLButtonElement[]} */ ([...group.querySelectorAll('[role="radio"]')]);
    const i = list.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    const next = list[(i + step + list.length) % list.length];
    next.focus();
    onSelect(next);
  });
}

/* ───────────── Theme ───────────── */
/** @param {string} theme 'system' | 'light' | 'dark' */
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  storage.set('cropr-theme', theme === 'system' ? null : theme);
  setChecked(dom.themeGroup, (b) => b.dataset.themeValue === theme);
}
radioGroup(dom.themeGroup, (b) => applyTheme(b.dataset.themeValue ?? 'system'));
applyTheme(document.documentElement.dataset.theme ?? 'system');

/* ───────────── Crop stage ───────────── */

/** The selection that the stage shows now. */
function shownSelection() {
  if (state.editing) return state.draft;
  if (state.mode === 'manual' && state.manual) return state.manual;
  return state.autoRect ? rectToSelection(state.autoRect, dom.page) : null;
}

function drawStage() {
  const sel = shownSelection();
  dom.sel.hidden = !sel;
  Object.values(dom.overlays).forEach((o) => {
    o.hidden = !sel;
  });
  if (!sel) return;

  const { x, y, w, h } = sel;
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

  dom.sel.classList.toggle('editing', state.editing);
  dom.sel.tabIndex = state.editing ? 0 : -1;
  dom.sel.setAttribute('role', state.editing ? 'group' : 'img');
  dom.sel.setAttribute(
    'aria-label',
    state.editing
      ? `Crop box: left ${Math.round(x * 100)}%, top ${Math.round(y * 100)}%, ` +
          `width ${Math.round(w * 100)}%, height ${Math.round(h * 100)}%`
      : 'Crop area',
  );
  if (state.editing) {
    const wIn = (w * state.pageSize.width) / 72;
    const hIn = (h * state.pageSize.height) / 72;
    dom.cropStatus.textContent = `${wIn.toFixed(1)} × ${hIn.toFixed(1)} in`;
  }
}

/** Texts and buttons that depend on the crop mode */
function updateCropControls() {
  const n = pageCount();
  const pagesText = n > 1 ? `all ${n} pages` : 'the page';
  const auto = state.mode === 'auto';

  setChecked(dom.modeGroup, (b) => (b === dom.auto) === auto);

  dom.tag.hidden = !auto;
  dom.tag.textContent = state.autoKind === 'top-half' ? 'Auto · top half' : 'Auto · whole page';

  dom.cropStatus.className = auto ? 'status' : 'mono';
  if (auto) {
    dom.cropStatus.textContent =
      state.autoKind === 'top-half' ? 'Top half · white space trimmed' : 'White space trimmed';
    dom.help.textContent =
      n > 1
        ? `Same crop rule on all ${n} pages. Check each page in the strip above.`
        : 'Cropr took the label area of the page and trimmed the white space.';
  } else if (state.editing) {
    dom.help.textContent = `Drag the box or its handles. Arrow keys move it, Shift + arrow keys resize it. The crop applies to ${pagesText}.`;
  } else {
    dom.cropStatus.textContent = 'Custom crop applied';
    dom.help.textContent = `Custom crop applied to ${pagesText}.`;
  }
  dom.cancel.hidden = dom.apply.hidden = !state.editing;
  dom.edit.hidden = auto || state.editing;
  drawStage();
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
    start: { ...state.draft },
  };
  dom.sel.setPointerCapture(e.pointerId);
});

dom.sel.addEventListener('pointermove', (e) => {
  if (!gesture) return;
  const dx = (e.clientX - gesture.x0) / gesture.width;
  const dy = (e.clientY - gesture.y0) / gesture.height;
  state.draft = gesture.handle
    ? resizeSelection(gesture.start, gesture.handle, dx, dy)
    : moveSelection(gesture.start, dx, dy);
  drawStage();
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
    applyCrop();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelCrop();
    return;
  }
  const next = selectionFromKey(state.draft, e.key, { resize: e.shiftKey, fine: e.altKey });
  if (!next) return;
  e.preventDefault();
  state.draft = next;
  drawStage();
});

/** @param {'auto' | 'manual'} mode */
function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  if (mode === 'manual' && !state.manual) {
    startEditing();
    return;
  }
  state.editing = false;
  updateCropControls();
  refreshOutput();
}

function startEditing() {
  state.editing = true;
  state.draft =
    state.manual ??
    (state.autoRect
      ? rectToSelection(state.autoRect, dom.page)
      : { x: 0.1, y: 0.1, w: 0.8, h: 0.4 });
  updateCropControls();
  updateActions();
  dom.sel.focus({ preventScroll: true });
}

function applyCrop() {
  if (!state.editing) return;
  state.manual = { ...state.draft };
  state.editing = false;
  updateCropControls();
  refreshOutput();
  dom.print.focus({ preventScroll: true });
}

function cancelCrop() {
  if (!state.editing) return;
  state.editing = false;
  if (!state.manual) state.mode = 'auto';
  updateCropControls();
  refreshOutput();
}

radioGroup(dom.modeGroup, (b) => setMode(b === dom.auto ? 'auto' : 'manual'));

/* ───────────── PDF rendering ───────────── */

/**
 * Render a page into a canvas at the given scale.
 * @param {PDFPageProxy} page @param {HTMLCanvasElement} canvas @param {number} scale
 */
function renderInto(page, canvas, scale) {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  return page.render({ canvas, viewport, intent: 'print' });
}

/**
 * The crop of one page bitmap, with the current mode.
 * @param {HTMLCanvasElement} canvas @param {{width: number, height: number}} sizePt
 */
function cropRectFor(canvas, sizePt) {
  if (state.mode === 'manual' && state.manual) {
    return selectionToPixels(state.manual, canvas.width, canvas.height);
  }
  return autoCropRect(canvas, autoCropArea(sizePt.width, sizePt.height).selection);
}

/** @param {number} pageNum */
async function showPage(pageNum) {
  const { pdf } = state;
  if (!pdf) return;
  const gen = ++state.renderGen;
  state.renderTask?.cancel();
  state.pageNum = pageNum;
  updateStrip();
  clearOutput();

  try {
    const page = await pdf.getPage(pageNum);
    if (gen !== state.renderGen) return;
    const size = page.getViewport({ scale: 1 });
    const task = renderInto(page, dom.page, RENDER_SCALE);
    state.renderTask = task;
    await task.promise;
    if (gen !== state.renderGen) return;

    state.pageSize = { width: size.width, height: size.height };
    const area = autoCropArea(size.width, size.height);
    state.autoKind = area.kind;
    state.autoRect = autoCropRect(dom.page, area.selection);
    updateCropControls();
    await refreshOutput();
  } catch (err) {
    if (err instanceof RenderingCancelledException) return;
    console.error(err);
    showError(
      `Cropr can't show page ${pageNum}`,
      'The page may be damaged. Try another page, or download the label again.',
    );
  }
}

/* ───────────── Page strip ───────────── */
function buildStrip() {
  const n = pageCount();
  dom.strip.replaceChildren();
  dom.stripSection.hidden = n < 2;
  if (n < 2) return;

  for (let i = 1; i <= n; i++) {
    const item = document.createElement('li');
    item.className = 'page-thumb';
    item.dataset.page = String(i);

    const frame = document.createElement('div');
    frame.className = 'page-thumb-frame';

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'page-thumb-select';
    select.setAttribute('aria-label', `Show page ${i}`);
    select.append(document.createElement('canvas'));
    select.addEventListener('click', () => {
      if (state.pageNum !== i) showPage(i);
    });

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'page-thumb-check';
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-label', `Print page ${i}`);
    check.addEventListener('click', () => {
      state.included[i - 1] = !state.included[i - 1];
      updateStrip();
      updateActions();
    });

    const label = document.createElement('span');
    label.className = 'page-thumb-label';
    label.textContent = `Page ${i}`;

    frame.append(select, check);
    item.append(frame, label);
    dom.strip.append(item);
  }
  updateStrip();
}

function updateStrip() {
  const n = pageCount();
  for (const item of /** @type {NodeListOf<HTMLElement>} */ (
    dom.strip.querySelectorAll('.page-thumb')
  )) {
    const i = Number(item.dataset.page);
    const on = state.included[i - 1];
    item.classList.toggle('current', i === state.pageNum);
    item.classList.toggle('excluded', !on);
    item
      .querySelector('.page-thumb-select')
      ?.setAttribute('aria-current', String(i === state.pageNum));
    const check = item.querySelector('.page-thumb-check');
    if (check) {
      check.setAttribute('aria-checked', String(on));
      check.textContent = on ? '✓' : '';
    }
  }
  const k = includedPages().length;
  dom.pageCount.textContent = k === n ? `All ${n} selected` : `${k} of ${n} selected`;
  dom.outputCount.textContent = n > 1 ? `Label ${state.pageNum} of ${n}` : '1 label';
}

/** Render the small page images one after another, after the first page shows. */
async function renderThumbnails() {
  const { pdf } = state;
  if (!pdf || pdf.numPages < 2) return;
  for (let i = 1; i <= pdf.numPages; i++) {
    if (state.pdf !== pdf) return; // a new file replaced this one
    const canvas = dom.strip.querySelector(`[data-page="${i}"] canvas`);
    if (!(canvas instanceof HTMLCanvasElement)) return;
    try {
      const page = await pdf.getPage(i);
      const scale = THUMB_PIXELS / page.getViewport({ scale: 1 }).width;
      await renderInto(page, canvas, scale).promise;
    } catch (err) {
      console.warn(`Thumbnail for page ${i} failed`, err);
    }
  }
}

/* ───────────── Output ───────────── */
function clearOutput() {
  state.outputGen += 1;
  if (state.output) URL.revokeObjectURL(state.output.url);
  state.output = null;
  updateActions();
}

function updateActions() {
  const n = includedPages().length;
  if (!state.busy) {
    dom.printLabel.textContent = n > 1 ? `Print all ${n} labels` : 'Print label';
    dom.downloadLabel.textContent = n > 1 ? 'Download PNGs' : 'Download PNG';
  }
  const ready = Boolean(state.output) && !state.editing && !state.busy && n > 0;
  dom.print.disabled = dom.download.disabled = !ready;
}

/** Make the PNG and the preview of the current page with the current settings. */
async function refreshOutput() {
  clearOutput();
  if (state.editing || !state.pdf) return;
  const gen = state.outputGen;

  /** @type {Awaited<ReturnType<typeof makeLabelPng>>} */
  let result;
  try {
    result = await makeLabelPng(dom.page, cropRectFor(dom.page, state.pageSize), {
      paper: state.paper,
      turn: state.turn,
      blackAndWhite: state.blackAndWhite,
    });
  } catch (err) {
    console.error(err);
    if (gen === state.outputGen) {
      showError("Cropr can't make the label", 'Try again. If it fails again, reload the page.');
    }
    return;
  }
  if (gen !== state.outputGen) return; // newer settings replaced this output

  drawPreview(result.label, result.placement);
  state.output = { url: URL.createObjectURL(result.blob), blob: result.blob };
  updateActions();
}

/**
 * The preview shows the whole paper: the label on Letter, or the 4×6 label.
 * @param {HTMLCanvasElement} label
 * @param {{dx: number, dy: number, dw: number, dh: number}} p
 */
function drawPreview(label, p) {
  const paper = PAPERS[state.paper];
  const s = PREVIEW_PIXELS[state.paper] / paper.width;
  dom.preview.width = Math.round(paper.width * s);
  dom.preview.height = Math.round(paper.height * s);
  dom.preview.className = `paper-${state.paper}`;
  const ctx = context2d(dom.preview);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, dom.preview.width, dom.preview.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(label, p.dx * s, p.dy * s, p.dw * s, p.dh * s);
  dom.outputMeta.textContent = `${paper.size} · ${DPI} DPI${state.turn ? ` · ${state.turn}°` : ''}`;
}

/**
 * Make the PNGs of all pages to print. The current page uses its PNG; the other
 * pages render one at a time, so only one extra page bitmap is in memory.
 * @returns {Promise<{pageNum: number, blob: Blob}[] | null>} null if the file changed
 */
async function buildLabels() {
  const { pdf, output } = state;
  if (!pdf || !output) return null;
  const pages = includedPages();
  /** @type {{pageNum: number, blob: Blob}[]} */
  const labels = [];
  for (const [i, pageNum] of pages.entries()) {
    if (pages.length > 1) dom.printLabel.textContent = `Preparing ${i + 1} of ${pages.length}…`;
    if (pageNum === state.pageNum) {
      labels.push({ pageNum, blob: output.blob });
      continue;
    }
    const page = await pdf.getPage(pageNum);
    const canvas = document.createElement('canvas');
    await renderInto(page, canvas, RENDER_SCALE).promise;
    const size = page.getViewport({ scale: 1 });
    const { blob } = await makeLabelPng(canvas, cropRectFor(canvas, size), {
      paper: state.paper,
      turn: state.turn,
      blackAndWhite: state.blackAndWhite,
    });
    canvas.width = canvas.height = 0; // free the bitmap memory now
    labels.push({ pageNum, blob });
    if (state.pdf !== pdf) return null;
  }
  return labels;
}

/** @param {(labels: {pageNum: number, blob: Blob}[]) => Promise<void> | void} action */
async function withLabels(action) {
  if (state.busy) return;
  state.busy = true;
  updateActions();
  try {
    const labels = await buildLabels();
    if (labels?.length) await action(labels);
  } catch (err) {
    console.error(err);
    showError("Cropr can't make the labels", 'Try again. If it fails again, reload the page.');
  } finally {
    state.busy = false;
    updateActions();
  }
}

/** @param {Blob} blob @param {string} name */
function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function download() {
  void withLabels(async (labels) => {
    if (labels.length === 1) {
      saveFile(labels[0].blob, 'shipping-label.png');
      return;
    }
    const files = await Promise.all(
      labels.map(async ({ pageNum, blob }) => ({
        name: `label-page-${pageNum}.png`,
        data: new Uint8Array(await blob.arrayBuffer()),
      })),
    );
    saveFile(new Blob([storeZip(files)], { type: 'application/zip' }), 'shipping-labels.zip');
  });
}

// Print from a hidden same-origin frame (print.html), so the app page does not
// change. print.html has no inline styles, so the CSP stays strict.
function print() {
  void withLabels(
    (labels) =>
      new Promise((resolve) => {
        document.querySelectorAll('iframe.print-frame').forEach((f) => f.remove());
        const urls = labels.map((l) => URL.createObjectURL(l.blob));
        const iframe = document.createElement('iframe');
        iframe.className = 'print-frame';
        iframe.title = 'Print';
        iframe.addEventListener(
          'load',
          async () => {
            const win = iframe.contentWindow;
            const doc = iframe.contentDocument;
            if (!win || !doc) return resolve();
            const size = state.paper === 'letter' ? 'letter' : '4in 6in';
            doc.styleSheets[0]?.insertRule(`@page { size: ${size}; margin: 0; }`, 0);
            const images = urls.map((url, i) => {
              const img = doc.createElement('img');
              img.alt = `Label, page ${labels[i].pageNum}`;
              img.src = url;
              return img;
            });
            doc.body.append(...images);
            await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
            win.addEventListener(
              'afterprint',
              () => {
                iframe.remove();
                urls.forEach((u) => URL.revokeObjectURL(u));
              },
              { once: true },
            );
            win.focus();
            win.print();
            resolve();
          },
          { once: true },
        );
        iframe.src = `${import.meta.env.BASE_URL}print.html`;
        document.body.append(iframe);
      }),
  );
}

/* ───────────── Output settings ───────────── */
/** @param {PaperKey} paper */
function setPaper(paper) {
  setChecked(dom.paperGroup, (b) => b.dataset.paper === paper);
  if (paper === state.paper) return;
  state.paper = paper;
  storage.set('cropr-paper', paper);
  refreshOutput();
}
radioGroup(dom.paperGroup, (b) => setPaper(b.dataset.paper === 'letter' ? 'letter' : '4x6'));
setChecked(dom.paperGroup, (b) => b.dataset.paper === state.paper);

/** @param {number} delta */
function rotate(delta) {
  state.turn = /** @type {Rotation} */ ((state.turn + delta + 360) % 360);
  refreshOutput();
}

dom.bw.addEventListener('click', () => {
  state.blackAndWhite = !state.blackAndWhite;
  dom.bw.setAttribute('aria-checked', String(state.blackAndWhite));
  refreshOutput();
});

/* ───────────── Loading and reset ───────────── */
/** @param {File} file */
const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** @param {boolean} loaded */
function showWorkspace(loaded) {
  dom.hero.hidden = dom.drop.hidden = dom.heroNotes.hidden = loaded;
  dom.workspace.hidden = dom.output.hidden = !loaded;
}

/** @param {File | undefined} file */
async function loadFile(file) {
  if (!file) return;
  if (!isPdf(file)) {
    showError(
      "That file isn't a PDF",
      'Cropr only reads PDF labels. Save the label as a PDF and try again.',
    );
    return;
  }

  hideError();
  dom.progress.hidden = false;
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
    Object.assign(state, {
      pdf,
      pageNum: 1,
      included: Array.from({ length: pdf.numPages }, () => true),
      mode: 'auto',
      manual: null,
      editing: false,
      turn: 0,
    });
    setProgress(50);

    const pages = `${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}`;
    dom.fileName.textContent = file.name;
    dom.fileMeta.textContent = `${pages} · ${formatSize(file.size)}`;
    showWorkspace(true);
    buildStrip();
    await showPage(1);
    setProgress(100);
    void renderThumbnails();
  } catch (err) {
    console.error(err);
    if (err instanceof PasswordException) {
      showError(
        'This PDF has a password',
        'Save a copy of the label without a password and try again.',
      );
    } else {
      showError(
        "Cropr can't read this PDF",
        'The file may be damaged. Download the label again and try again.',
      );
    }
  } finally {
    dom.progress.hidden = true;
    dom.file.value = ''; // so that the same file can be chosen again
  }
}

function reset() {
  state.renderGen += 1;
  state.renderTask?.cancel();
  void state.pdf?.loadingTask.destroy();
  Object.assign(state, {
    pdf: null,
    included: [],
    autoRect: null,
    mode: 'auto',
    manual: null,
    editing: false,
    turn: 0,
  });
  clearOutput();
  dom.file.value = '';
  dom.strip.replaceChildren();
  hideError();
  showWorkspace(false);
  dom.browse.focus();
}

/* ───────────── Event wiring ───────────── */
dom.browse.addEventListener('click', () => dom.file.click());
dom.replace.addEventListener('click', () => dom.file.click());
dom.drop.addEventListener('click', (e) => {
  // A click anywhere in the drop zone opens the file dialog. The button does
  // this already, and dom.file.click() also sends a click to here.
  if (e.target === dom.file || dom.browse.contains(/** @type {Node} */ (e.target))) return;
  dom.file.click();
});
dom.file.addEventListener('change', () => loadFile(dom.file.files?.[0]));
dom.errorDismiss.addEventListener('click', hideError);

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

dom.apply.addEventListener('click', applyCrop);
dom.cancel.addEventListener('click', cancelCrop);
dom.edit.addEventListener('click', startEditing);
dom.rotateLeft.addEventListener('click', () => rotate(-90));
dom.rotateRight.addEventListener('click', () => rotate(90));
dom.download.addEventListener('click', download);
dom.print.addEventListener('click', print);
dom.reset.addEventListener('click', reset);
