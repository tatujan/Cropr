import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  FRAME,
  PAGE,
  addCanvasNoise,
  countBlack,
  decodeBilevelPng,
  makeTestPdf,
} from './helpers.js';

/** @typedef {import('@playwright/test').Page} Page */

const pdfFile = (pages = 1) => ({
  name: 'label.pdf',
  mimeType: 'application/pdf',
  buffer: makeTestPdf(pages),
});

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
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  await expect(page.locator('#progressContainer')).toBeHidden(); // layout is stable now
}

/** @param {Page} page */
async function downloadPng(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#downloadBtn').click(),
  ]);
  expect(download.suggestedFilename()).toBe('shipping-label.png');
  return decodeBilevelPng(await readFile(await download.path()));
}

/**
 * Width of the black border on each side of the preview, at the middle of each side.
 * @param {Page} page
 */
function previewBorder(page) {
  return page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('croppedCanvas'));
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    const { width: w, height: h } = c;
    const d = ctx.getImageData(0, 0, w, h).data;
    /** @param {number} x @param {number} y */
    const black = (x, y) => d[(y * w + x) * 4] === 0;
    /** @param {(i: number) => boolean} fn @param {number} n */
    const run = (fn, n) => {
      let i = 0;
      while (i < n && fn(i)) i++;
      return i;
    };
    const my = Math.floor(h / 2) + 40; // away from the text line
    const mx = Math.floor(w / 2) + 40;
    return {
      left: run((i) => black(i, my), w),
      right: run((i) => black(w - 1 - i, my), w),
      top: run((i) => black(mx, i), h),
      bottom: run((i) => black(mx, h - 1 - i), h),
    };
  });
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

test('auto crop makes a 1-bit Letter PNG with only the top half of the page', async ({ page }) => {
  const errors = trackErrors(page);
  await upload(page);
  const png = await downloadPng(page);

  expect({ w: png.width, h: png.height, depth: png.bitDepth, type: png.colorType }).toEqual({
    w: 2550,
    h: 3300,
    depth: 1,
    type: 0,
  });
  expect(countBlack(png, 0, 0, png.width, 1650)).toBeGreaterThan(10_000); // label
  expect(countBlack(png, 0, 1650)).toBe(0); // bottom half: pure white
  expect(errors).toEqual([]);
});

for (const width of [1280, 420]) {
  test(`the crop is the area that the selection box shows (window width ${width})`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width, height: 1400 });
    await upload(page);
    await page.locator('#manualCropBtn').click();
    await expect(page.locator('#selectionBox')).toBeVisible();

    // Put the box edges on the 4 pt frame line. The exact position does not
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
    await expect(page.locator('#downloadBtn')).toBeEnabled();
    const size = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.getElementById('croppedCanvas'));
      return { w: c.width, h: c.height };
    });

    // Expected black width on each side: from the box edge to the inner edge
    // of the frame line (half of 4 pt), scaled like the output.
    const half = { x: 2 / PAGE.width, y: 2 / PAGE.height };
    const sx = size.w / (shown.x1 - shown.x0);
    const sy = size.h / (shown.y1 - shown.y0);
    const expected = {
      left: (FRAME.x0 + half.x - shown.x0) * sx,
      right: (shown.x1 - (FRAME.x1 - half.x)) * sx,
      top: (FRAME.y0 + half.y - shown.y0) * sy,
      bottom: (shown.y1 - (FRAME.y1 - half.y)) * sy,
    };
    const border = await previewBorder(page);
    for (const side of /** @type {const} */ (['left', 'right', 'top', 'bottom'])) {
      expect(expected[side], `${side} edge must be on the line`).toBeGreaterThan(3);
      // 1 px rounding in the page bitmap and 1 px at the threshold, scaled to the output
      expect(Math.abs(border[side] - expected[side]), side).toBeLessThanOrEqual(4);
    }
    expect(errors).toEqual([]);
  });
}

test('keyboard moves and resizes the selection, Enter confirms', async ({ page }) => {
  await upload(page);
  await page.locator('#manualCropBtn').click();
  const box = page.locator('#selectionBox');
  await expect(box).toBeFocused();

  const before = await box.evaluate((el) => ({ left: el.style.left, height: el.style.height }));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const after = await box.evaluate((el) => ({ left: el.style.left, height: el.style.height }));
  expect(parseFloat(after.left)).toBeCloseTo(parseFloat(before.left) + 2, 5);
  expect(parseFloat(after.height)).toBeCloseTo(parseFloat(before.height) + 1, 5);

  await page.keyboard.press('Enter');
  await expect(box).toBeHidden();
  await expect(page.locator('#downloadBtn')).toBeEnabled();
});

test('canvas read-back noise does not reach the PNG', async ({ page }) => {
  await upload(page);
  const clean = await downloadPng(page);

  await page.addInitScript(addCanvasNoise);
  await page.reload();
  await upload(page);
  const noisy = await downloadPng(page);

  expect(countBlack(noisy, 0, 1650)).toBe(0);
  // Noise can only change pixels very near the threshold.
  const a = countBlack(clean);
  const b = countBlack(noisy);
  expect(Math.abs(a - b) / a).toBeLessThan(0.01);
});

test('page buttons change the page and make the output again', async ({ page }) => {
  await upload(page, 2);
  await expect(page.locator('#pageInfo')).toHaveText('Page 1 of 2');
  await expect(page.locator('#prevPageBtn')).toBeDisabled();

  await page.locator('#nextPageBtn').click();
  await expect(page.locator('#pageInfo')).toHaveText('Page 2 of 2');
  await expect(page.locator('#nextPageBtn')).toBeDisabled();
  await expect(page.locator('#downloadBtn')).toBeEnabled();
});

test('print loads the label into the print frame and prints it', async ({ page }) => {
  const errors = trackErrors(page);
  await upload(page);
  await page.locator('#printBtn').click();

  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__printCalls)).toBe(1);
  const frame = page.frameLocator('iframe.print-frame');
  await expect(frame.locator('#label')).toHaveAttribute('src', /^blob:/);
  expect(errors).toEqual([]);
});

test('wrong file type and damaged PDF show a message', async ({ page }) => {
  const error = page.locator('#errorMsg');
  await page.locator('#fileInput').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await expect(error).toHaveText('Please choose a PDF file.');

  await page.locator('#fileInput').setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a pdf'),
  });
  await expect(error).toHaveText(/Could not read this PDF/);
});

test('reset clears the preview and the output', async ({ page }) => {
  await upload(page);
  await page.locator('#resetBtn').click();
  await expect(page.locator('#previewContainer')).toBeHidden();
  await expect(page.locator('#emptyPreview')).toBeVisible();
  await expect(page.locator('#downloadBtn')).toBeDisabled();

  await upload(page); // the app works again after reset
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
