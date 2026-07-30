import type { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIGRATIONS_DIR } from '../config.js';
import { withTransaction } from './transaction.js';

/**
 * Applies any .sql files in db/migrations that have not been applied yet, in
 * filename order, each inside its own transaction.
 *
 * Files are named NNN_description.sql. The numeric prefix is the version and
 * must be unique and monotonic — that ordering is the whole contract.
 */
export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const applied = new Set<number>(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => (r as { version: number }).version),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');

  for (const file of files) {
    const version = Number(file.slice(0, file.indexOf('_')));
    if (!Number.isInteger(version)) {
      throw new Error(`Migration "${file}" does not start with a numeric version prefix.`);
    }
    if (applied.has(version)) continue;

    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');

    // better-sqlite3 cannot run PRAGMA foreign_keys inside a transaction, and
    // the migration files set it defensively; strip it — db/index.ts has
    // already enabled it on the connection.
    const body = sql.replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;\s*$/gim, '');

    withTransaction(db, () => {
      db.exec(body);
      record.run(version, file);
    });

    console.log(`[db] applied migration ${file}`);
  }
}
