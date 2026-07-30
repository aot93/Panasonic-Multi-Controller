/**
 * tsc only emits JS. The .sql migration files and the built frontend need to
 * land in dist/ so `node dist/index.js` runs standalone.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');

const migrationsSrc = resolve(pkg, 'src/db/migrations');
const migrationsDest = resolve(pkg, 'dist/db/migrations');
mkdirSync(migrationsDest, { recursive: true });
cpSync(migrationsSrc, migrationsDest, { recursive: true });
console.log('copied migrations -> dist/db/migrations');

// The frontend build output is served as static files from the same server.
const webSrc = resolve(pkg, '../frontend/dist');
const webDest = resolve(pkg, 'dist/public');
if (existsSync(webSrc)) {
  mkdirSync(webDest, { recursive: true });
  cpSync(webSrc, webDest, { recursive: true });
  console.log('copied frontend -> dist/public');
} else {
  console.log('frontend not built yet; skipping dist/public');
}
