#!/usr/bin/env node
/**
 * Vendors the Tesseract.js runtime assets (WASM core + English language
 * data) into packages/frontend/public/tesseract/ so the browser never
 * fetches them from a CDN at runtime — required by this app's "local only,
 * no internet" design goal (see docs/vision-name-verification-plan.md §4).
 *
 * Run once after `npm install` (not wired into postinstall deliberately —
 * it does a one-time network fetch for the language data, which shouldn't
 * happen silently on every install). Idempotent: skips anything already
 * present, so re-running is harmless.
 *
 * The WASM core files come straight out of node_modules/tesseract.js-core
 * (already resolved by `npm install`, no separate fetch needed) — only the
 * LSTM variants (the engine mode this app uses; see createWorker.js's
 * default OEM.LSTM_ONLY) are copied, not the legacy-engine variants the
 * package also ships, to keep the vendored footprint down. All three LSTM
 * variants (plain/SIMD/relaxedSIMD) are needed, not just one — which one
 * the browser's own WASM feature-detection picks at runtime isn't something
 * this app controls, and a missing variant fails as a hard runtime error
 * (`importScripts` 404), not a silent fallback. The English trained data
 * isn't published to npm at all; it's fetched once from the same source
 * tesseract.js's own docs point to (docs/local-installation.md in the
 * installed package).
 */
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_SRC = resolve(ROOT, 'node_modules/tesseract.js-core');
const WORKER_SRC = resolve(ROOT, 'node_modules/tesseract.js/dist/worker.min.js');
const DEST = resolve(ROOT, 'packages/frontend/public/tesseract');

const CORE_FILES = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];
const LANG_URL = 'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz';

async function copyIfMissing(src, dest) {
  if (existsSync(dest)) {
    console.log(`  skip (already present): ${dest}`);
    return;
  }
  await copyFile(src, dest);
  console.log(`  copied: ${dest}`);
}

async function fetchIfMissing(url, dest) {
  if (existsSync(dest)) {
    console.log(`  skip (already present): ${dest}`);
    return;
  }
  console.log(`  fetching ${url} ...`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  await pipeline(res.body, createWriteStream(dest));
  console.log(`  saved: ${dest}`);
}

async function main() {
  if (!existsSync(CORE_SRC) || !existsSync(WORKER_SRC)) {
    throw new Error('tesseract.js / tesseract.js-core not found in node_modules — run `npm install` first.');
  }

  mkdirSync(resolve(DEST, 'core'), { recursive: true });
  mkdirSync(resolve(DEST, 'lang'), { recursive: true });

  console.log('Vendoring Tesseract.js worker script:');
  await copyIfMissing(WORKER_SRC, resolve(DEST, 'worker.min.js'));

  console.log('Vendoring Tesseract WASM core (all 3 LSTM variants):');
  for (const file of CORE_FILES) {
    await copyIfMissing(resolve(CORE_SRC, file), resolve(DEST, 'core', file));
  }

  console.log('Vendoring English language data (one-time network fetch):');
  await fetchIfMissing(LANG_URL, resolve(DEST, 'lang', 'eng.traineddata.gz'));

  console.log('\nDone — packages/frontend/public/tesseract/ is ready.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
