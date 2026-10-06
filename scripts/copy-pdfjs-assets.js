// Copy the PDF.js runtime assets (wasm decoders, standard fonts, CMaps, ICC
// profiles) from node_modules to public/pdfjs/, so the app serves them itself.
import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'pdfjs-dist');
const to = join(root, 'public', 'pdfjs');

rmSync(to, { recursive: true, force: true });
for (const dir of ['wasm', 'standard_fonts', 'cmaps', 'iccs']) {
  cpSync(join(from, dir), join(to, dir), { recursive: true });
}
