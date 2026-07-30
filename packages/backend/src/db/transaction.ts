import type { DatabaseSync } from 'node:sqlite';

/**
 * Runs `fn` inside BEGIN/COMMIT, rolling back on throw.
 *
 * node:sqlite has no `.transaction()` wrapper the way better-sqlite3 does, so
 * this is that wrapper. Not reentrant — nested calls on the same connection
 * will fail on the inner BEGIN, since SQLite has no true nested transactions;
 * callers needing that should use SAVEPOINT explicitly instead.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}
