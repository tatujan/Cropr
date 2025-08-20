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
    // page navigation
    pageControls: $('pageControls'), pageInfo: $('pageInfo'),
    prevPage: $('prevPageBtn'), nextPage: $('nextPageBtn'),
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
  let currentPage = 1;
  let totalPages  = 1;
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
    const canvasFrame = dom.oCan.parentElement; // the canvas-frame div
    const frameRect = canvasFrame.getBoundingClientRect();
    const canvasRect = dom.oCan.getBoundingClientRect();
    
    // Calculate selection position relative to frame
    const canvasOffsetInFrame = { 
      x: canvasRect.left - frameRect.left, 
      y: canvasRect.top - frameRect.top 
    };
    
    const selInFrame = {
      left: sel.x + canvasOffsetInFrame.x,
      top: sel.y + canvasOffsetInFrame.y,
      right: sel.x + sel.w + canvasOffsetInFrame.x,
      bottom: sel.y + sel.h + canvasOffsetInFrame.y
    };
    
    dom.ovT.style.cssText = `left:0;top:0;width:100%;height:${px(selInFrame.top)};display:block`;
    dom.ovB.style.cssText = `left:0;top:${px(selInFrame.bottom)};width:100%;height:${px(frameRect.height - selInFrame.bottom)};display:block`;
    dom.ovL.style.cssText = `left:0;top:${px(selInFrame.top)};width:${px(selInFrame.left)};height:${px(sel.h)};display:block`;
    dom.ovR.style.cssText = `left:${px(selInFrame.right)};top:${px(selInFrame.top)};width:${px(frameRect.width - selInFrame.right)};height:${px(sel.h)};display:block`;
  }
  const drawSel = () => {
    const canvasFrame = dom.oCan.parentElement;
    const frameRect = canvasFrame.getBoundingClientRect();
    const canvasRect = dom.oCan.getBoundingClientRect();
    
    // Position selection box relative to frame, accounting for canvas position
    const canvasOffsetInFrame = { 
      x: canvasRect.left - frameRect.left, 
      y: canvasRect.top - frameRect.top 
    };
    
    const frameX = sel.x + canvasOffsetInFrame.x;
    const frameY = sel.y + canvasOffsetInFrame.y;
    
    dom.sel.style.cssText = `display:block;left:${px(frameX)};top:${px(frameY)};width:${px(sel.w)};height:${px(sel.h)}`;
    syncOverlay();
  };

  /* -------------- 7.  COMPOSE CROPPED BITMAP ONTO US LETTER PNG ------------ */
  function letterFrom(srcCanvas, sw, sh, isManualCrop = false) {
    const out = document.createElement('canvas');
    out.width  = LETTER.w;            // 2550 px
    out.height = LETTER.h;            // 3300 px

    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);

    /* detect if label is vertical (taller than wide) */
    const isVertical = sh > sw * 1.2;  // aspect ratio threshold
    
    /* enforce 50% page height limit - margins only for manual crop */
    const margin = isManualCrop ? 60 : 0;  // 0.2 inch margin at 300 DPI for manual only
    const maxHeight = LETTER.h / 2 - (margin * 2);   // 1650px (auto) or 1530px (manual)
    const maxWidth = out.width - (margin * 2);       // 2550px (auto) or 2430px (manual)
    let scale, scaledW, scaledH, dx, dy;
    
    if (isVertical) {
      /* rotate 90 degrees clockwise for vertical labels */
      scale = Math.min(maxWidth / sh, maxHeight / sw);
      scaledW = sh * scale;  // rotated: height becomes width
      scaledH = sw * scale;  // rotated: width becomes height
      
      /* center the rotated label within top 50% */
      dx = (out.width - scaledW) / 2;
      dy = margin + (maxHeight - scaledH) / 2;  // margin (0 for auto) + center within available height
      
      ctx.save();
      ctx.translate(dx + scaledW/2, dy + scaledH/2);
      ctx.rotate(Math.PI / 2);  // 90 degrees clockwise
      ctx.drawImage(srcCanvas, -sw*scale/2, -sh*scale/2, sw*scale, sh*scale);
      ctx.restore();
    } else {
      /* normal horizontal processing */
      scale = Math.min(maxWidth / sw, maxHeight / sh);
      scaledW = sw * scale;
      scaledH = sh * scale;
      
      /* center within top 50% of page */
      dx = (out.width - scaledW) / 2;
      dy = margin + (maxHeight - scaledH) / 2;  // margin (0 for auto) + center within available height
      
      ctx.drawImage(srcCanvas, 0, 0, sw, sh, dx, dy, scaledW, scaledH);
    }

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

    // 3. compose onto US-Letter + store PNG (auto crop - no margins)
    pngDataURL = letterFrom(dom.cCan, fullW, cropH, false);
    dom.dl.disabled = dom.pr.disabled = false;
  }

  function cropManual() {
    // Scale factor from visual canvas to actual canvas pixels  
    const canvasRect = dom.oCan.getBoundingClientRect();
    const scale = dom.oCan.width / canvasRect.width;

    console.log('Debug cropManual (simplified):');
    console.log('Selection (canvas-relative):', sel.x, sel.y, sel.w, sel.h);
    console.log('Canvas visual size:', canvasRect.width, canvasRect.height);
    console.log('Canvas actual size:', dom.oCan.width, dom.oCan.height);
    console.log('Scale factor:', scale);

    // Rectangle in source-canvas pixels (coordinates are already canvas-relative)
    const sx = Math.max(0, Math.round(sel.x * scale));
    const sy = Math.max(0, Math.round(sel.y * scale));
    const sw = Math.round(sel.w * scale);
    const sh = Math.round(sel.h * scale);

    console.log('Final coords:', sx, sy, sw, sh);

    // Ensure coordinates are within canvas bounds
    const finalSx = Math.min(sx, dom.oCan.width - sw);
    const finalSy = Math.min(sy, dom.oCan.height - sh);
    const finalSw = Math.min(sw, dom.oCan.width - finalSx);
    const finalSh = Math.min(sh, dom.oCan.height - finalSy);

    const srcCtx = dom.oCan.getContext('2d');
    const img = srcCtx.getImageData(finalSx, finalSy, finalSw, finalSh);

    dom.cCan.width = finalSw;
    dom.cCan.height = finalSh;
    dom.cCan.getContext('2d').putImageData(img, 0, 0);

    pngDataURL = letterFrom(dom.cCan, finalSw, finalSh, true);  // manual crop - with margins
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

      const canvasRect = dom.oCan.getBoundingClientRect();
      const cw = canvasRect.width;
      const ch = canvasRect.height;
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
    totalPages = pdfDoc.numPages;
    currentPage = 1;
    
    /* show page controls if multi-page */
    if (totalPages > 1) {
      dom.pageControls.classList.remove('hidden');
      updatePageControls();
    }
    
    await renderPage(currentPage);
    
    dom.pSection.classList.remove('hidden');
    dom.empty.classList.add('hidden');
    switchMode(false); // default = AUTO
  }
  
  /* ---------------- 11.  RENDER SPECIFIC PAGE ---------------- */
  async function renderPage(pageNum) {
    if (!pdfDoc || pageNum < 1 || pageNum > totalPages) return;
    
    setPct(0);
    const page = await pdfDoc.getPage(pageNum);
    const view = page.getViewport({ scale: DPI / 72 });
    dom.oCan.width = view.width; 
    dom.oCan.height = view.height;

    const ctx = dom.oCan.getContext('2d');
    const task = page.render({ canvasContext: ctx, viewport: view });
    task.onProgress = p => setPct(50 + (p.loaded / p.total) * 50);
    await task.promise;
    setPct(100); setTimeout(() => dom.pWrap.classList.add('hidden'), 400);

    /* shrink preview visually */
    const cssW = Math.min(view.width, PREVIEW);
    dom.oCan.style.width  = px(cssW);
    dom.oCan.style.height = px(cssW * view.height / view.width);
    
    /* reset crop state */
    dom.dl.disabled = dom.pr.disabled = true;
    pngDataURL = null;
    if (manualMode) {
      switchMode(true); // refresh manual selection
    } else {
      cropAuto();
    }
  }
  
  /* ---------------- 12.  PAGE NAVIGATION ---------------- */
  function updatePageControls() {
    dom.pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    dom.prevPage.disabled = currentPage <= 1;
    dom.nextPage.disabled = currentPage >= totalPages;
  }
  
  async function switchToPage(pageNum) {
    if (pageNum < 1 || pageNum > totalPages) return;
    currentPage = pageNum;
    updatePageControls();
    await renderPage(currentPage);
  }

  /* ---------------- 13.  PRINT --------------------------------------- */
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

  /* ---------------- 14.  DRAG & RESIZE ---------------- */
  /* drag */
  let dragging = false, dOX = 0, dOY = 0;
  dom.sel.addEventListener('mousedown', e => {
    if (!manualMode || e.target.classList.contains('handle')) return;
    dragging = true; dOX = e.offsetX; dOY = e.offsetY;
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const canvasRect = dom.oCan.getBoundingClientRect();
    sel.x = Math.min(Math.max(0, e.clientX - canvasRect.left - dOX), canvasRect.width  - sel.w);
    sel.y = Math.min(Math.max(0, e.clientY - canvasRect.top  - dOY), canvasRect.height - sel.h);
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

  /* ---------------- 15.  UPLOAD / DRAG & DROP WIRING ---------------- */
  dom.browse.addEventListener('click', () => dom.file.click());
  dom.file.addEventListener('change', e => loadFile(e.target.files[0]));
  ['dragenter','dragover'].forEach(ev => dom.drop.addEventListener(ev, e => { e.preventDefault(); dom.drop.classList.add('active'); }));
  ['dragleave','dragend','drop'].forEach(ev => dom.drop.addEventListener(ev, e => { e.preventDefault(); dom.drop.classList.remove('active'); }));
  dom.drop.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));

  /* ---------------- 16.  BUTTONS (mode / confirm / DL / print / reset / page nav) ---------------- */
  dom.auto  .addEventListener('click', () => switchMode(false));
  dom.manual.addEventListener('click', () => switchMode(true));
  dom.ok    .addEventListener('click', () => { if (manualMode) { cropManual(); dom.sel.style.display = 'none'; dom.ok.disabled = true; overlays.forEach(o => o.style.display='none'); } });

  dom.dl.addEventListener('click', () => {
    if (!pngDataURL) return;
    const a = document.createElement('a'); a.href = pngDataURL; a.download = 'shipping-label.png'; a.click();
  });
  dom.pr.addEventListener('click', printPNG);
  dom.reset.addEventListener('click', () => location.reload());
  
  /* page navigation */
  dom.prevPage.addEventListener('click', () => switchToPage(currentPage - 1));
  dom.nextPage.addEventListener('click', () => switchToPage(currentPage + 1));
});
