#!/usr/bin/env node
/**
 * Vendors the DOOM easter egg's runtime assets into
 * packages/frontend/public/doom-engine/ so the browser never fetches them
 * from a CDN — same "local only, no internet" rule as
 * scripts/setup-ocr-assets.mjs, and the same reason: this app is meant to
 * run fully offline off a packaged exe.
 *
 * Two pieces:
 *  - js-dos (DOSBox-in-WASM player): copied straight out of
 *    node_modules/js-dos/dist, already resolved by `npm install`, no fetch
 *    needed.
 *  - DOOM.EXE + DOOM1.WAD: the original id Software v1.9 shareware episode
 *    (1995), which id's own README.TXT (shipped alongside them) explicitly
 *    authorizes distributing complete and unmodified. Not on npm, so this
 *    fetches the archive.org mirror of the original shareware package
 *    (doom_dos.ZIP, itself a preserved copy of the file every DOS shareware
 *    BBS in 1995 carried) and checks each extracted file's SHA-256 against
 *    the well-known values for the final v1.9 release before trusting it —
 *    both files get executed (as DOS binaries, inside DOSBox's x86
 *    emulation — not on the host) so verifying the download wasn't
 *    tampered with in transit is worth the few extra lines.
 *
 * Run once after `npm install` (not wired into postinstall — the zip fetch
 * is a one-time network hit that shouldn't happen silently on every
 * install). Idempotent: skips anything already present.
 */
import { createWriteStream, cpSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSDOS_SRC = resolve(ROOT, 'node_modules/js-dos/dist');
const DEST = resolve(ROOT, 'packages/frontend/public/doom-engine');
const SHAREWARE_ZIP_URL = 'https://archive.org/download/doom_20230531/doom_dos.ZIP';

// Known-good SHA-256 of the final v1.9 shareware release (1995-02-01, id
// Software) — matches the checksums published on doomwiki.org's DOOM1.WAD
// and DOOM.EXE version-history pages.
const EXPECTED_SHA256 = {
  'DOOM.EXE': 'b8020523561a5ad9706e009a52d61c578f37faafd85ac471962308406292ce27',
  'DOOM1.WAD': '1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771',
};

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function copyIfMissing(src, dest) {
  if (existsSync(dest)) {
    console.log(`  skip (already present): ${dest}`);
    return;
  }
  cpSync(src, dest, { recursive: true });
  console.log(`  copied: ${dest}`);
}

async function fetchDoomExeAndWadIfMissing() {
  const exeDest = resolve(DEST, 'DOOM.EXE');
  const wadDest = resolve(DEST, 'DOOM1.WAD');
  if (existsSync(exeDest) && existsSync(wadDest)) {
    console.log(`  skip (already present): ${exeDest}, ${wadDest}`);
    return;
  }

  console.log(`  fetching ${SHAREWARE_ZIP_URL} ...`);
  const res = await fetch(SHAREWARE_ZIP_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch ${SHAREWARE_ZIP_URL}: ${res.status} ${res.statusText}`);
  }
  const zipPath = resolve(DEST, '_doom_dos.zip');
  await pipeline(res.body, createWriteStream(zipPath));

  const zip = new AdmZip(zipPath);
  for (const [name, dest] of [['DOOM.EXE', exeDest], ['DOOM1.WAD', wadDest]]) {
    const entry = zip.getEntry(name);
    if (!entry) throw new Error(`${name} not found inside ${SHAREWARE_ZIP_URL}`);
    const data = entry.getData();
    const actual = sha256(data);
    if (actual !== EXPECTED_SHA256[name]) {
      throw new Error(
        `${name} SHA-256 mismatch — expected ${EXPECTED_SHA256[name]}, got ${actual}. ` +
          `The mirror may have changed; not writing an unverified file.`,
      );
    }
    writeFileSync(dest, data);
    console.log(`  extracted + verified: ${dest}`);
  }

  unlinkSync(zipPath);
}

async function main() {
  if (!existsSync(JSDOS_SRC)) {
    throw new Error(`${JSDOS_SRC} not found — run \`npm install\` first (js-dos is a frontend devDependency).`);
  }

  mkdirSync(DEST, { recursive: true });

  console.log('Vendoring js-dos player...');
  copyIfMissing(resolve(JSDOS_SRC, 'js-dos.js'), resolve(DEST, 'js-dos.js'));
  copyIfMissing(resolve(JSDOS_SRC, 'js-dos.css'), resolve(DEST, 'js-dos.css'));
  copyIfMissing(resolve(JSDOS_SRC, 'emulators'), resolve(DEST, 'emulators'));

  console.log('Vendoring DOOM.EXE + DOOM1.WAD (v1.9 shareware, freely redistributable)...');
  await fetchDoomExeAndWadIfMissing();

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
