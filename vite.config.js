import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// vercel.json is the one source for the security headers. `vite preview` (and
// so the Playwright tests) uses the same headers as production.
/** @type {{headers: {source: string, headers: {key: string, value: string}[]}[]}} */
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
const allRoutes = vercel.headers.find((h) => h.source === '/(.*)');
if (!allRoutes) throw new Error('vercel.json: no headers for "/(.*)"');
const securityHeaders = Object.fromEntries(
  allRoutes.headers
    // COOP makes Playwright's Firefox hang on page.goto in about 1 of 25 runs
    // (process swap on navigation). Real browsers are not affected, so
    // production keeps it; only the local preview server drops it.
    .filter((h) => h.key !== 'Cross-Origin-Opener-Policy')
    .map((h) => [h.key, h.value]),
);

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script', // an external file, which the CSP allows
      manifest: {
        name: 'Cropr – PDF Label Cropper',
        short_name: 'Cropr',
        description: 'Crop PDF shipping labels and print them. Everything stays in your browser.',
        theme_color: '#009966',
        background_color: '#f6f7f5',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // App shell, PDF.js worker, wasm decoders and standard fonts work offline.
        // CMaps (only for CJK text) load on demand and are cached after first use.
        globPatterns: [
          '**/*.{html,js,mjs,css,svg,wasm,webmanifest}',
          'pdfjs/standard_fonts/*',
          'pdfjs/iccs/*',
          'assets/*-wght-normal-*.woff2',
        ],
        globIgnores: ['pdfjs/wasm/*_nowasm_fallback.js', 'pdfjs/wasm/quickjs-*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/pdfjs/cmaps/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-cmaps' },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: { main: 'index.html', print: 'print.html' },
    },
  },
  preview: { headers: securityHeaders },
  test: {
    include: ['test/unit/**/*.test.js'],
  },
});
