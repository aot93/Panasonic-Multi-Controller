#!/usr/bin/env node
/**
 * Packages the backend + built frontend into a single Windows executable
 * using Node's built-in Single Executable Applications (SEA) feature —
 * "download and run", per spec §7, without npm install or a database setup
 * step on the target machine.
 *
 * How it fits together:
 *   1. `npm run build` produces packages/backend/dist/{index.js, db/migrations, public}.
 *   2. esbuild bundles index.js + every npm dependency (express, socket.io,
 *      node-cron, zod, ...) into one CJS file. `node:*` builtins — including
 *      node:sqlite, this project's whole reason for avoiding better-sqlite3's
 *      native addon — are left as external `require()`s automatically.
 *   3. Node's `--experimental-sea-config` turns that bundle into a blob.
 *   4. A copy of the current node.exe has that blob injected via `postject`
 *      under the SEA sentinel fuse — the result is one executable containing
 *      the Node runtime and the entire app.
 *   5. The built frontend (`public/`) and the SQL migrations (`migrations/`)
 *      ship as plain folders next to the exe, NOT embedded as SEA assets —
 *      see the note in packages/backend/src/config.ts for why: it keeps
 *      express.static and the migration scanner completely unchanged, at the
 *      cost of "one file" being "one exe + two small folders" instead of
 *      truly one file. A fully embedded version is a reasonable future step
 *      (`node:sea`'s getAsset() API supports it) but wasn't necessary to hit
 *      "download and run".
 *
 * macOS/Linux are NOT implemented here — see the README printed at the end
 * and docs/PROGRESS.md for why (short version: SEA injection is
 * platform-specific — you need to inject into *that* platform's node
 * binary — so this has to run ON or FOR the target OS, which this Windows
 * dev machine can't produce or verify).
 */
import { build as esbuildBuild } from 'esbuild';
import { inject as postjectInject } from 'postject';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_DIST = resolve(ROOT, 'packages/backend/dist');
const APP_NAME = 'ProjectorControl';

/**
 * The SEA sentinel fuse is compiled into each node binary and its value is
 * NOT the widely-quoted `fce680ab-2cc4-46e2-b638-387c95f7c69a` doc example —
 * that's stale for this Node build. The real one must be read out of the
 * actual binary being packaged (it's the literal text
 * "NODE_SEA_FUSE_<hex>:0" embedded at build time; postject flips that
 * trailing 0 to a 1 to mark "this binary has an embedded blob").
 */
function readSeaFuse(exePath) {
  const buffer = readFileSync(exePath);
  const marker = Buffer.from('NODE_SEA_FUSE_', 'ascii');
  const start = buffer.indexOf(marker);
  if (start === -1) {
    throw new Error(`Could not find the NODE_SEA_FUSE marker in ${exePath} — this Node build may not support SEA.`);
  }
  const colon = buffer.indexOf(':', start);
  if (colon === -1) {
    throw new Error(`Found "NODE_SEA_FUSE_" in ${exePath} but no ':' terminator after it — unexpected binary layout.`);
  }
  return buffer.toString('ascii', start, colon);
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  // .cmd shims (npm.cmd, postject.cmd) aren't real executables on Windows —
  // execFileSync needs shell:true to resolve/run them via cmd.exe.
  const needsShell = process.platform === 'win32' && cmd.toLowerCase().endsWith('.cmd');
  execFileSync(cmd, args, { stdio: 'inherit', shell: needsShell, ...opts });
}

async function packageWindows() {
  const releaseDir = resolve(ROOT, 'release/win');

  console.log('\n== 1/6 Building shared/frontend/backend ==');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: ROOT });

  if (!existsSync(resolve(BACKEND_DIST, 'index.js'))) {
    throw new Error('Expected packages/backend/dist/index.js to exist after build — did the backend build fail?');
  }

  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(releaseDir, { recursive: true });

  console.log('\n== 2/6 Bundling the backend (esbuild) ==');
  const bundlePath = resolve(releaseDir, '_bundle.cjs');
  await esbuildBuild({
    entryPoints: [resolve(BACKEND_DIST, 'index.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'info',
    // config.ts's `import.meta.url` branch only ever runs when NOT packaged
    // (isSea() is false) — esbuild correctly warns that import.meta is inert
    // in a CJS bundle, but that branch is dead code in the shipped exe.
    logOverride: { 'empty-import-meta': 'silent' },
  });

  console.log('\n== 3/6 Generating the SEA blob ==');
  const seaConfigPath = resolve(releaseDir, 'sea-config.json');
  const blobPath = resolve(releaseDir, '_blob.bin');
  writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: bundlePath,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    ),
  );
  run(process.execPath, ['--experimental-sea-config', seaConfigPath]);

  console.log('\n== 4/6 Copying the Node runtime ==');
  const exePath = resolve(releaseDir, `${APP_NAME}.exe`);
  copyFileSync(process.execPath, exePath);

  console.log('\n== 5/6 Removing the copied exe\'s existing code signature (best-effort) ==');
  try {
    run('signtool', ['remove', '/s', exePath]);
  } catch {
    console.warn(
      '  signtool not found (needs the Windows SDK) — proceeding without removing the signature.\n' +
        '  If the packaged exe refuses to launch, that\'s the likely cause: install the Windows SDK\n' +
        '  and re-run this script, or re-sign the exe yourself after packaging.',
    );
  }

  console.log('\n== 6/6 Injecting the application blob (postject) ==');
  const seaFuse = readSeaFuse(exePath);
  console.log(`  using sentinel fuse read from the binary: ${seaFuse}`);
  await postjectInject(exePath, 'NODE_SEA_BLOB', readFileSync(blobPath), {
    sentinelFuse: seaFuse,
    overwrite: true,
  });

  console.log('\n== Copying assets next to the executable ==');
  cpSync(resolve(BACKEND_DIST, 'public'), resolve(releaseDir, 'public'), { recursive: true });
  cpSync(resolve(BACKEND_DIST, 'db/migrations'), resolve(releaseDir, 'migrations'), { recursive: true });

  rmSync(bundlePath, { force: true });
  rmSync(blobPath, { force: true });
  rmSync(seaConfigPath, { force: true });

  writeFileSync(
    resolve(releaseDir, 'README.txt'),
    [
      `${APP_NAME}`,
      '',
      'To run: double-click ' + `${APP_NAME}.exe` + '.',
      '',
      'On first run this creates a "data" folder next to the executable',
      'holding the SQLite database and an encryption key for stored',
      'projector passwords — back up that folder if you want to preserve',
      'registered devices, schedules, and macros.',
      '',
      'The app listens on http://localhost:8080 by default — open that in a',
      'browser on this machine, or http://<this-machine\'s-LAN-IP>:8080 from',
      'a phone or another computer on the same network. Set the PPC_PORT',
      'environment variable before launching to use a different port.',
      '',
      'Keep the "public" and "migrations" folders next to the executable —',
      'the app reads them at startup.',
    ].join('\n'),
  );

  console.log(`\nDone: ${exePath}`);
  console.log(`Release folder: ${releaseDir}`);
}

async function main() {
  const platform = process.argv[2] ?? 'win';
  if (platform !== 'win') {
    console.error(
      `Only "win" is implemented. macOS needs its own run of this on/for a Mac — SEA injection is\n` +
        `platform-specific (a different postject invocation against a macOS node binary, plus its own\n` +
        `codesigning story) and can't be produced or verified from this Windows machine. See docs/PROGRESS.md.`,
    );
    process.exit(1);
  }
  await packageWindows();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
