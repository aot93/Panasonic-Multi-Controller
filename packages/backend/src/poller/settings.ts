import type { DatabaseSync } from 'node:sqlite';

/**
 * Reads a numeric row from the generic `settings` key/value table, falling
 * back if the key is missing or holds something non-numeric. The migration's
 * seed INSERT (001_init.sql) always populates the poller-relevant keys, so
 * the fallback mainly guards a corrupted or hand-edited settings row rather
 * than first-run absence.
 */
export function getNumberSetting(db: DatabaseSync, key: string, fallback: number): number {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Settings are stored as text; booleans are the convention "1" = true, anything else = false. */
export function getBooleanSetting(db: DatabaseSync, key: string, fallback: boolean): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  return row.value === '1';
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (key) DO UPDATE SET value = @value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).run({ key, value });
}
