#!/usr/bin/env node
/**
 * Copies user-facing static docs into packages/frontend/public/ so Vite's
 * build carries them through to dist/ (and, from there, copy-assets.mjs and
 * scripts/package.mjs's existing pipelines put them next to the packaged
 * exe) with zero packaging-script changes — same pattern already used for
 * the vendored Tesseract assets.
 *
 * docs/UserGuide.md and LICENSE stay the single hand-edited source of
 * truth; this just mirrors them for the in-app About page
 * (components/AboutPage.tsx) to fetch. Cheap, synchronous, no network — run
 * automatically on every frontend dev/build rather than as a manual step.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = resolve(ROOT, 'packages/frontend/public');

mkdirSync(PUBLIC_DIR, { recursive: true });
copyFileSync(resolve(ROOT, 'docs/UserGuide.md'), resolve(PUBLIC_DIR, 'UserGuide.md'));
copyFileSync(resolve(ROOT, 'LICENSE'), resolve(PUBLIC_DIR, 'LICENSE.txt'));
console.log('copied docs/UserGuide.md and LICENSE -> packages/frontend/public/');
