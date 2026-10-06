import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  FRAME,
  FRAME_LINE,
  PAGE,
  addCanvasNoise,
  blackBounds,
  countBlack,
  decodeBilevelPng,
  makeTestPdf,
  readStoreZip,
} from './helpers.js';

/** @typedef {import('@playwright/test').Page} Page */

const pdfFile = (pages = 1) => ({
  name: 'labels.pdf',
  mimeType: 'application/pdf',
  buffer: makeTestPdf(pages),
});

/** The frame of the test PDF, at 300 DPI, from its outer edges */
const FRAME_PX = {
  w: Math.round(((FRAME.x1 - FRAME.x0) * PAGE.width + FRAME_LINE) * (300 / 72)),
  h: Math.round(((FRAME.y1 - FRAME.y0) * PAGE.height + FRAME_LINE) * (300 / 72)),
};

/**
 * Record console errors and uncaught exceptions. CSP violations also show here.
 * @param {Page} page
 */
function trackErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** @param {Page} page */
async function upload(page, pages = 1) {
  await page.locator('#fileInput').setInputFiles(pdfFile(pages));
  await expect(page.locator('#printBtn')).toBeEnabled();
  await expect(page.locator('#progressContainer')).toBeHidden(); // layout is stable now
}

/** @param {Page} page */
async function downloadFile(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#downloadBtn').click(),
  ]);
  return { name: download.suggestedFilename(), data: await readFile(await download.path()) };
}

/** @param {Page} page */
async function downloadPng(page) {
  const file = await downloadFile(page);
  expect(file.name).toBe('shipping-label.png');
  return decodeBilevelPng(file.data);
}

/** @param {Page} page @param {'letter' | '4x6'} paper */
async function choosePaper(page, paper) {
  await page.locator(`[data-paper="${paper}"]`).click();
  await expect(page.locator(`[data-paper="${paper}"]`)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#printBtn')).toBeEnabled();
}

/**
 * Drag a selection handle to a point given as page fractions.
 * @param {Page} page @param {string} handle @param {number} fx @param {number} fy
 */
async function dragHandle(page, handle, fx, fy) {
  const stage = await page.locator('#cropStage').boundingBox();
  const h = await page.locator(`[data-handle="${handle}"]`).boundingBox();
  if (!stage || !h) throw new Error('missing element');
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + fx * stage.width, stage.y + fy * stage.height, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  // Printing opens a system dialog. Record the call instead, in all frames.
  await page.addInitScript(() => {
    window.print = () => {
      const top = /** @type {any} */ (window.top);
      top.__printCalls = (top.__printCalls ?? 0) + 1;
    };
  });
  await page.goto('/');
});

test('auto crop trims the label and prints it at true size on 4×6 paper', async ({ page }) => {
  const errors = trackErrors(page);
  await upload(page);
  await expect(page.locator('#cropTag')).toHaveText('Auto · top half');
  await expect(page.locator('[data-paper="4x6"]')).toHaveAttribute('aria-checked', 'true');

  const png = await downloadPng(page);
  expect({ w: png.width, h: png.height, depth: png.bitDepth, type: png.colorType }).toEqual({
    w: 1200,
    h: 1800,
    depth: 1,
    type: 0,
  });
  // The black frame is the label content: the trim removed the white space around it
  const box = blackBounds(png);
  expect(Math.abs(box.w - FRAME_PX.w)).toBeLessThanOrEqual(6);
  expect(Math.abs(box.h - FRAME_PX.h)).toBeLessThanOrEqual(6);
  expect(Math.abs(box.x0 + box.x1 - png.width)).toBeLessThanOrEqual(2); // centered
  expect(errors).toEqual([]);
});

test('Letter paper keeps the label in the top half', async ({ page }) => {
  await upload(page);
  await choosePaper(page, 'letter');
  const png = await downloadPng(page);
  expect({ w: png.width, h: png.height }).toEqual({ w: 2550, h: 3300 });
  expect(countBlack(png, 0, 0, png.width, 1650)).toBeGreaterThan(10_000);
  expect(countBlack(png, 0, 1650)).toBe(0);
});

test('rotate turns the label on the paper', async ({ page }) => {
  await upload(page);
  const before = blackBounds(await downloadPng(page));
  await page.locator('#rotateRightBtn').click();
  await expect(page.locator('#outputMeta')).toHaveText('4 × 6 in · 300 DPI · 90°');
  await expect(page.locator('#printBtn')).toBeEnabled();
  const after = blackBounds(await downloadPng(page));
  expect(Math.abs(after.w - before.h)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.h - before.w)).toBeLessThanOrEqual(2);
});

for (const width of [1280, 420]) {
  test(`the crop is the area that the selection box shows (window width ${width})`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width, height: 1400 });
    await upload(page);
    await page.locator('#manualCropBtn').click();
    await expect(page.locator('#selectionBox')).toHaveClass(/editing/);

    // Put the box edges on the frame line. The exact position does not
    // matter (some browsers round mouse positions to whole pixels).
    await dragHandle(page, 'nw', FRAME.x0, FRAME.y0);
    await dragHandle(page, 'se', FRAME.x1, FRAME.y1);

    // What the user sees: the box position as page fractions
    const shown = await page.evaluate(() => {
      const stage = /** @type {HTMLElement} */ (document.getElementById('cropStage'));
      const box = /** @type {HTMLElement} */ (document.getElementById('selectionBox'));
      const s = stage.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return {
        x0: (b.left - s.left) / s.width,
        y0: (b.top - s.top) / s.height,
        x1: (b.right - s.left) / s.width,
        y1: (b.bottom - s.top) / s.height,
      };
    });

    await page.locator('#confirmCropBtn').click();
    await expect(page.locator('#printBtn')).toBeEnabled();

    // The crop fits on 4×6 at true size, so the PNG holds it 1:1. Its edges are
    // in the frame line, so the black box of the PNG is the crop.
    const png = await downloadPng(page);
    const crop = blackBounds(png);
    const sx = crop.w / (shown.x1 - shown.x0);
    const sy = crop.h / (shown.y1 - shown.y0);
    /** @param {number} x0 @param {number} y0 @param {number} dx @param {number} dy */
    const run = (x0, y0, dx, dy) => {
      let n = 0;
      while (png.isBlack(x0 + n * dx, y0 + n * dy)) n++;
      return n;
    };
    const midY = Math.floor((crop.y0 + crop.y1) / 2) + 40; // away from the text line
    const midX = Math.floor((crop.x0 + crop.x1) / 2) + 40;
    const border = {
      left: run(crop.x0, midY, 1, 0),
      right: run(crop.x1 - 1, midY, -1, 0),
      top: run(midX, crop.y0, 0, 1),
      bottom: run(midX, crop.y1 - 1, 0, -1),
    };

    // Expected black width on each side: from the box edge to the inner edge
    // of the frame line (half its width).
    const half = { x: FRAME_LINE / 2 / PAGE.width, y: FRAME_LINE / 2 / PAGE.height };
    const expected = {
      left: (FRAME.x0 + half.x - shown.x0) * sx,
      right: (shown.x1 - (FRAME.x1 - half.x)) * sx,
      top: (FRAME.y0 + half.y - shown.y0) * sy,
      bottom: (shown.y1 - (FRAME.y1 - half.y)) * sy,
    };
    for (const side of /** @type {const} */ (['left', 'right', 'top', 'bottom'])) {
      expect(expected[side], `${side} edge must be on the line`).toBeGreaterThan(3);
      // 1 px rounding in the page bitmap and 1 px at the threshold
      expect(Math.abs(border[side] - expected[side]), side).toBeLessThanOrEqual(3);
    }
    expect(errors).toEqual([]);
  });
}

test('keyboard moves and resizes the crop box, Enter applies, Escape cancels', async ({ page }) => {
  await upload(page);
  await page.locator('#manualCropBtn').click();
  const box = page.locator('#selectionBox');
  await expect(box).toBeFocused();
  await expect(page.locator('#printBtn')).toBeDisabled(); // no printing while editing

  const before = await box.evaluate((el) => ({ left: el.style.left, height: el.style.height }));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const after = await box.evaluate((el) => ({ left: el.style.left, height: el.style.height }));
  expect(parseFloat(after.left)).toBeCloseTo(parseFloat(before.left) + 2, 5);
  expect(parseFloat(after.height)).toBeCloseTo(parseFloat(before.height) + 1, 5);

  await page.keyboard.press('Enter');
  await expect(box).not.toHaveClass(/editing/);
  await expect(page.locator('#cropStatus')).toHaveText('Custom crop applied');
  await expect(page.locator('#printBtn')).toBeEnabled();

  await page.locator('#editCropBtn').click();
  await expect(box).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(box).not.toHaveClass(/editing/);
  await expect(page.locator('#manualCropBtn')).toHaveAttribute('aria-checked', 'true');
});

test('canvas read-back noise does not reach the PNG', async ({ page }) => {
  await upload(page);
  await choosePaper(page, 'letter');
  const clean = await downloadPng(page);

  await page.addInitScript(addCanvasNoise);
  await page.reload();
  await upload(page); // Letter is still chosen: the choice is saved
  const noisy = await downloadPng(page);

  expect(countBlack(noisy, 0, 1650)).toBe(0);
  // Noise can only change pixels very near the threshold.
  const a = countBlack(clean);
  const b = countBlack(noisy);
  expect(Math.abs(a - b) / a).toBeLessThan(0.01);
});

test('page strip: show another page, leave a page out, download a ZIP', async ({ page }) => {
  const errors = trackErrors(page);
  await upload(page, 3);
  await expect(page.locator('#pageCount')).toHaveText('All 3 selected');
  await expect(page.locator('#outputCount')).toHaveText('Label 1 of 3');
  await expect(page.locator('#printLabel')).toHaveText('Print all 3 labels');

  await page.getByRole('button', { name: 'Show page 2' }).click();
  await expect(page.locator('#outputCount')).toHaveText('Label 2 of 3');
  await expect(page.getByRole('button', { name: 'Show page 2' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page.locator('#printBtn')).toBeEnabled();

  await page.getByRole('checkbox', { name: 'Print page 3' }).click();
  await expect(page.locator('#pageCount')).toHaveText('2 of 3 selected');
  await expect(page.locator('#printLabel')).toHaveText('Print all 2 labels');

  const zip = await downloadFile(page);
  expect(zip.name).toBe('shipping-labels.zip');
  const files = readStoreZip(zip.data);
  expect(files.map((f) => f.name)).toEqual(['label-page-1.png', 'label-page-2.png']);
  for (const f of files) {
    const png = decodeBilevelPng(f.data);
    expect({ w: png.width, h: png.height, depth: png.bitDepth }).toEqual({
      w: 1200,
      h: 1800,
      depth: 1,
    });
  }
  expect(errors).toEqual([]);
});

test('print puts each label on its own page at the chosen paper size', async ({ page }) => {
  const errors = trackErrors(page);
  await upload(page, 2);
  await page.locator('#printBtn').click();

  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__printCalls)).toBe(1);
  const frame = page.frameLocator('iframe.print-frame');
  await expect(frame.locator('img')).toHaveCount(2);
  await expect(frame.locator('img').first()).toHaveAttribute('src', /^blob:/);
  const pageRule = await page
    .locator('iframe.print-frame')
    .evaluate(
      (f) =>
        /** @type {HTMLIFrameElement} */ (f).contentDocument?.styleSheets[0].cssRules[0].cssText,
    );
  expect(pageRule).toMatch(/size: 4in 6in/);
  expect(errors).toEqual([]);
});

test('wrong file type and damaged PDF show a message', async ({ page }) => {
  const alert = page.locator('#errorAlert');
  await page.locator('#fileInput').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await expect(page.locator('#errorTitle')).toHaveText("That file isn't a PDF");

  await page.locator('#errorDismiss').click();
  await expect(alert).toBeHidden();

  await page.locator('#fileInput').setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a pdf'),
  });
  await expect(page.locator('#errorTitle')).toHaveText("Cropr can't read this PDF");
});

test('start over goes back to the drop zone', async ({ page }) => {
  await upload(page);
  await page.locator('#resetBtn').click();
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#output')).toBeHidden();
  await expect(page.locator('#dropZone')).toBeVisible();
  await expect(page.locator('#browseBtn')).toBeFocused();

  await upload(page); // the app works again after start over
});

test('theme toggle: Day, Dark and System, saved for the next visit', async ({ page }) => {
  const html = page.locator('html');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark'); // before main.js runs, too
  await expect(page.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');

  // Arrow keys move the choice in the radio group
  await page.getByRole('radio', { name: 'Dark' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.getByRole('radio', { name: 'Match system' }).click();
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
});

test('works offline after the first visit', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright supports offline service workers in Chromium');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // the service worker controls the page from now
  await context.setOffline(true);
  await page.reload();
  await upload(page);
  const png = await downloadPng(page);
  expect(countBlack(png)).toBeGreaterThan(10_000);
});
