import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, ensureDataDir } from '../config.js';
import { runMigrations } from './migrate.js';
import { withTransaction } from './transaction.js';

export type Db = DatabaseSync;

let db: Db | null = null;

/**
 * Opens (and on first call, migrates) the SQLite database.
 *
 * Uses Node's built-in `node:sqlite` (stable since Node 22.13/24) rather than
 * better-sqlite3: identical synchronous, single-file semantics, but no
 * node-gyp native compile step — which matters twice over here. It removes
 * the Visual Studio Build Tools requirement for anyone setting up a dev
 * environment, and it removes a native .node addon from what phase 7 has to
 * embed in the single-executable build.
 */
export function getDb(): Db {
  if (db) return db;

  ensureDataDir();
  const handle = new DatabaseSync(DB_PATH);

  // WAL lets the poller write while HTTP requests read, without blocking.
  handle.exec('PRAGMA journal_mode = WAL;');
  // NORMAL is the standard WAL pairing: durable across process crashes,
  // only at risk from OS-level power loss, and far faster than FULL.
  handle.exec('PRAGMA synchronous = NORMAL;');
  handle.exec('PRAGMA foreign_keys = ON;');
  // Wait rather than throwing SQLITE_BUSY if a write overlaps.
  handle.exec('PRAGMA busy_timeout = 5000;');

  runMigrations(handle);

  db = handle;
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * node:sqlite has no `.transaction()` helper (unlike better-sqlite3) — this
 * wraps a block in BEGIN/COMMIT with rollback on throw. Re-exported from here
 * so call sites only need one import for "give me a database and a way to
 * run atomically against it".
 */
export { withTransaction };
