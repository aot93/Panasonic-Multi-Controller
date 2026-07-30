import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { isSea } from 'node:sea';

/**
 * Phase 7 packages the app as a single SEA executable (see
 * scripts/package.mjs) with the built frontend and SQL migrations shipped as
 * plain folders (`public/`, `migrations/`) next to the exe — not embedded as
 * SEA assets. That keeps express.static and the migration file scanner
 * working completely unchanged; only *where* those folders are looked for
 * needs to differ.
 *
 * `import.meta.url` has no meaningful "file location" once this module is
 * bundled and injected into a SEA blob, so it's only used in the
 * non-packaged branch (`node dist/index.js`, dev or a plain install).
 */
const packaged = isSea();
const exeDir = () => dirname(process.execPath);
const compiledFileDir = () => dirname(fileURLToPath(import.meta.url));

/**
 * Where mutable runtime state lives. Packaged: next to the executable, so
 * "download and run" needs no separate configuration step. Otherwise:
 * relative to the process working directory, unchanged from phases 1-6.
 * PPC_DATA_DIR overrides either default.
 */
export const DATA_DIR = process.env.PPC_DATA_DIR
  ? resolve(process.env.PPC_DATA_DIR)
  : resolve(packaged ? exeDir() : process.cwd(), 'data');

export const DB_PATH = process.env.PPC_DB_PATH
  ? resolve(process.env.PPC_DB_PATH)
  : resolve(DATA_DIR, 'projectors.sqlite');

/** Directory holding the numbered .sql migrations. */
export const MIGRATIONS_DIR = packaged ? resolve(exeDir(), 'migrations') : resolve(compiledFileDir(), 'db/migrations');

/** Built frontend, served as static files from this same server. */
export const PUBLIC_DIR = packaged ? resolve(exeDir(), 'public') : resolve(compiledFileDir(), 'public');

/**
 * User-facing release number shown in the About page and `/api/health` —
 * deliberately not tied to package.json's npm/semver version. Bump by 0.1
 * per release (1.0, 1.1, 1.2, ...); this is the one place that changes.
 */
export const APP_VERSION = '1.0';

export const HTTP_PORT = Number(process.env.PPC_PORT ?? 8080);

/** Bind address. 0.0.0.0 so phones and tablets on the LAN can reach it. */
export const HTTP_HOST = process.env.PPC_HOST ?? '0.0.0.0';

/**
 * Key used to encrypt projector passwords at rest. Generated on first run and
 * stored in the data directory if not supplied via the environment.
 */
export const SECRET_KEY_PATH = resolve(DATA_DIR, 'secret.key');

export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}
