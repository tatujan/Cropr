/* =======================================================================
   SHIPPING-LABEL CROPPER  -  300 dpi - Auto+Manual crop - In-page print
   Batuhan  Mekiker July, 2025
   =======================================================================*/

document.addEventListener('DOMContentLoaded', () => {
  /* ───────────── 1.  DOM helpers ─────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const px = v => `${v}px`;

  /* ---------------- 2.  ELEMENTS WE TOUCH ---------------- */
  const dom = {
    // upload
    drop: $('dropZone'), file: $('fileInput'), browse: $('browseBtn'),
    // progress
    pWrap: $('progressContainer'), bar: $('progressBar'), pct: $('progressPercent'),
    // preview
    pSection: $('previewContainer'), empty: $('emptyPreview'),
    oCan: $('originalCanvas'), cCan: $('croppedCanvas'),
    // buttons
    auto: $('autoCropBtn'), manual: $('manualCropBtn'), ok: $('confirmCropBtn'),
    dl: $('downloadBtn'),   pr: $('printBtn'),   reset: $('resetBtn'),
    // manual-crop ui
    sel: $('selectionBox'),
    handles: Array.from(document.querySelectorAll('#selectionBox .handle')),
    ovT: $('ovTop'), ovL: $('ovLeft'), ovR: $('ovRight'), ovB: $('ovBottom')
  };
  const overlays = [dom.ovT, dom.ovL, dom.ovR, dom.ovB];

  /* ---------------- 3.  CONTANSTS & STATE ---------------- */
  const DPI      = 300;
  const LETTER   = { w: 2550, h: 3300 };
  const PREVIEW  = 800; // on-screen width (CSS only)
  let pdfDoc     = null;
  let manualMode = false;
  let pngDataURL = null;
  const sel = { x:0, y:0, w:0, h:0 }; // selection rectangle (CSS space)

  /* ---------------- 4.  PDF.JS WORKER PATH ---------------- */
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

  /* ---------------- 5.  UTILITY – UPDATE PROGRESS BAR ---------------- */
  const setPct = p => { dom.bar.style.width = `${p}%`; dom.pct.textContent = `${Math.round(p)} %`; };

  /* ---------------- 6.  OVERLAY HELPERS (MANUAL CROP) ---------------- */
  function syncOverlay() {
    const c = dom.oCan.getBoundingClientRect(), s = dom.sel.getBoundingClientRect();
    dom.ovT.style.cssText = `left:0;top:0;width:100%;height:${px(s.top-c.top)};display:block`;
    dom.ovB.style.cssText = `left:0;top:${px(s.bottom-c.top)};width:100%;height:${px(c.bottom-s.bottom)};display:block`;
    dom.ovL.style.cssText = `left:0;top:${px(s.top-c.top)};width:${px(s.left-c.left)};height:${px(s.height)};display:block`;
    dom.ovR.style.cssText = `left:${px(s.right-c.left)};top:${px(s.top-c.top)};width:${px(c.right-s.right)};height:${px(s.height)};display:block`;
  }
  const drawSel = () => {
    dom.sel.style.cssText = `display:block;left:${px(sel.x)};top:${px(sel.y)};width:${px(sel.w)};height:${px(sel.h)}`;
    syncOverlay();
  };

  /* -------------- 7.  COMPOSE CROPPED BITMAP ONTO US LETTER PNG ------------ */
  function letterFrom(srcCanvas, sw, sh) {
    const out = document.createElement('canvas');
    out.width  = LETTER.w;            // 2550 px
    out.height = LETTER.h;            // 3300 px

    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);

    /* centre horizontally, stick to the very top vertically */
    const scale = Math.min(out.width / sw, out.height / sh);
    const dx    = (out.width - sw * scale) / 2;   // centre X
    const dy    = 0;                              // TOP of page

    ctx.drawImage(srcCanvas, 0, 0, sw, sh,
                  dx, dy, sw * scale, sh * scale);

    return out.toDataURL('image/png', /*quality*/ 1);
  }



  /* ---------------- 8. CROP AUTO-MANUAL ---------------- */
  function cropAuto() {
    // 1. copy the top half of the hi-dpi original canvas
    const fullW = dom.oCan.width;
    const fullH = dom.oCan.height;
    const cropH = Math.floor(fullH / 2);

    const srcCtx = dom.oCan.getContext('2d');
    const img    = srcCtx.getImageData(0, 0, fullW, cropH);

    // 2. paste into cropped canvas (same pixel size)
    dom.cCan.width  = fullW;
    dom.cCan.height = cropH;
    dom.cCan.getContext('2d').putImageData(img, 0, 0);

    // 3. compose onto US-Letter + store PNG
    pngDataURL = letterFrom(dom.cCan, fullW, cropH);
    dom.dl.disabled = dom.pr.disabled = false;
  }

  function cropManual() {
    const scale = dom.oCan.width / parseFloat(dom.oCan.style.width);

    // rectangle in source-canvas pixels
    const sx = Math.round(sel.x * scale);
    const sy = Math.round(sel.y * scale);
    const sw = Math.round(sel.w * scale);
    const sh = Math.round(sel.h * scale);

    // guard-rail: make sure coords are inside the canvas
    const srcCtx = dom.oCan.getContext('2d');
    const img    = srcCtx.getImageData(sx, sy, sw, sh);

    dom.cCan.width  = sw;
    dom.cCan.height = sh;
    dom.cCan.getContext('2d').putImageData(img, 0, 0);

    pngDataURL = letterFrom(dom.cCan, sw, sh);
    dom.dl.disabled = dom.pr.disabled = false;
  }

  /* ---------------- 9.  MODE SWITCH ---------------- */
  function switchMode(toManual) {
    manualMode = toManual;
    dom[toManual ? 'manual' : 'auto'].classList.replace('bg-gray-300','bg-primary');
    dom[toManual ? 'manual' : 'auto'].classList.replace('text-gray-700','text-white');
    dom[!toManual ? 'manual' : 'auto'].classList.replace('bg-primary','bg-gray-300');
    dom[!toManual ? 'manual' : 'auto'].classList.replace('text-white','text-gray-700');

    if (toManual) {
      /* disable DL/Print until user confirms */
      dom.dl.disabled = dom.pr.disabled = true;

      const cw = parseFloat(dom.oCan.style.width),
            ch = parseFloat(dom.oCan.style.height);
      sel.w = cw * 0.8;
      sel.h = ch * 0.4;
      sel.x = (cw - sel.w) / 2;
      sel.y = (ch - sel.h) / 4;
      drawSel();

      dom.ok.disabled = false;
    } else {
      dom.sel.style.display = 'none';
      overlays.forEach(o => (o.style.display = 'none'));
      dom.ok.disabled = true;
      cropAuto();       
    }
  }

  /* ---------------- 10.  FILE LOAD & RENDER (300 dpi) ---------------- */
  async function loadFile(file) {
    if (!file || file.type !== 'application/pdf') { alert('Please upload a PDF'); return; }

    dom.pWrap.classList.remove('hidden'); setPct(0);

    pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const page  = await pdfDoc.getPage(1);
    const view  = page.getViewport({ scale: DPI / 72 });
    dom.oCan.width = view.width; dom.oCan.height = view.height;

    const ctx = dom.oCan.getContext('2d');
    const task = page.render({ canvasContext: ctx, viewport: view });
    task.onProgress = p => setPct(50 + (p.loaded / p.total) * 50);
    await task.promise;
    setPct(100); setTimeout(() => dom.pWrap.classList.add('hidden'), 400);

    /* shrink preview visually */
    const cssW = Math.min(view.width, PREVIEW);
    dom.oCan.style.width  = px(cssW);
    dom.oCan.style.height = px(cssW * view.height / view.width);

    dom.pSection.classList.remove('hidden');
    dom.empty.classList.add('hidden');
    switchMode(false); // default = AUTO
  }

  /* ---------------- 11.  PRINT --------------------------------------- */
  function printPNG() {
    if (!pngDataURL) return;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0'; iframe.style.bottom = '0';
    iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0';
    document.body.appendChild(iframe);

    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => iframe.remove(), 500);
    };

    iframe.srcdoc = `
      <!DOCTYPE html><html><head>
        <meta charset="utf-8">
        <style>
          @page { size: Letter; margin: 0; }
          body  { margin: 0; }
          img   { display:block; width:100%; height:auto; }
        </style>
      </head><body>
        <img src="${pngDataURL}">
      </body></html>`;
  }

  /* ---------------- 12.  DRAG & RESIZE ---------------- */
  /* drag */
  let dragging = false, dOX = 0, dOY = 0;
  dom.sel.addEventListener('mousedown', e => {
    if (!manualMode || e.target.classList.contains('handle')) return;
    dragging = true; dOX = e.offsetX; dOY = e.offsetY;
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const r = dom.oCan.getBoundingClientRect();
    sel.x = Math.min(Math.max(0, e.clientX - r.left - dOX), r.width  - sel.w);
    sel.y = Math.min(Math.max(0, e.clientY - r.top  - dOY), r.height - sel.h);
    drawSel();
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  /* resize */
  let resizing = false, dir = '', S = {};
  dom.handles.forEach(h => h.addEventListener('mousedown', e => {
    if (!manualMode) return; e.stopPropagation();
    resizing = true; dir = h.classList[1];
    S = { mx:e.clientX,my:e.clientY,x:sel.x,y:sel.y,w:sel.w,h:sel.h,
          r: dom.oCan.getBoundingClientRect() };
  }));
  window.addEventListener('mousemove', e => {
    if (!resizing) return;
    const dx = e.clientX - S.mx, dy = e.clientY - S.my;
    if (dir.includes('e')) sel.w = Math.min(S.w + dx, S.r.width - S.x);
    if (dir.includes('s')) sel.h = Math.min(S.h + dy, S.r.height - S.y);
    if (dir.includes('w')) { sel.w = Math.min(S.w - dx, S.w + S.x); sel.x = S.x + S.w - sel.w; }
    if (dir.includes('n')) { sel.h = Math.min(S.h - dy, S.h + S.y); sel.y = S.y + S.h - sel.h; }
    drawSel();
  });
  window.addEventListener('mouseup', () => { resizing = false; });

  /* ---------------- 13.  UPLOAD / DRAG & DROP WIRING ---------------- */
  dom.browse.addEventListener('click', () => dom.file.click());
  dom.file.addEventListener('change', e => loadFile(e.target.files[0]));
  ['dragenter','dragover'].forEach(ev => dom.drop.addEventListener(ev, e => { e.preventDefault(); dom.drop.classList.add('active'); }));
  ['dragleave','dragend','drop'].forEach(ev => dom.drop.addEventListener(ev, e => { e.preventDefault(); dom.drop.classList.remove('active'); }));
  dom.drop.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));

  /* ---------------- 14.  BUTTONS (mode / confirm / DL / print / reset) ---------------- */
  dom.auto  .addEventListener('click', () => switchMode(false));
  dom.manual.addEventListener('click', () => switchMode(true));
  dom.ok    .addEventListener('click', () => { if (manualMode) { cropManual(); dom.sel.style.display = 'none'; dom.ok.disabled = true; overlays.forEach(o => o.style.display='none'); } });

  dom.dl.addEventListener('click', () => {
    if (!pngDataURL) return;
    const a = document.createElement('a'); a.href = pngDataURL; a.download = 'shipping-label.png'; a.click();
  });
  dom.pr.addEventListener('click', printPNG);
  dom.reset.addEventListener('click', () => location.reload());
});
