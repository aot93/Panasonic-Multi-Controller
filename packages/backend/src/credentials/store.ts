import type { DatabaseSync } from 'node:sqlite';
import { decryptSecret, encryptSecret } from '../db/crypto.js';
import type { NtControlCredentials } from '../protocol/types.js';

/**
 * Username/password management with two tiers, per the note that the spec
 * missed this: most fleets share one admin account across every unit, but
 * some units are configured differently (the repo's own reference scripts
 * alone use two different admin accounts) — so both a global default and a
 * per-device override are first-class, not just the override.
 *
 * Resolution order for a given device: its own username/password if either
 * is set, falling back to the global default for whichever half is missing.
 * That means a device can override just the password and keep inheriting
 * the global username, or vice versa.
 *
 * Storage: `devices.username` / `devices.password_enc` hold the per-device
 * override (NULL = inherit). The global default lives in the generic
 * `settings` key/value table as `global_username` (plaintext — a username is
 * not a secret) and `global_password_enc` (AES-256-GCM ciphertext via
 * db/crypto.ts, hex-encoded since `settings.value` is TEXT).
 */

const GLOBAL_USERNAME_KEY = 'global_username';
const GLOBAL_PASSWORD_KEY = 'global_password_enc';

export function getGlobalCredentials(db: DatabaseSync): NtControlCredentials | null {
  const usernameRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(GLOBAL_USERNAME_KEY) as
    | { value: string }
    | undefined;
  const passwordRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(GLOBAL_PASSWORD_KEY) as
    | { value: string }
    | undefined;

  if (!usernameRow || !passwordRow) return null;

  const password = decryptSecret(Buffer.from(passwordRow.value, 'hex'));
  if (password === null) return null;

  return { username: usernameRow.value, password };
}

export function setGlobalCredentials(db: DatabaseSync, credentials: NtControlCredentials): void {
  const passwordHex = encryptSecret(credentials.password).toString('hex');
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (@key, @value, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT (key) DO UPDATE SET value = @value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `);
  upsert.run({ key: GLOBAL_USERNAME_KEY, value: credentials.username });
  upsert.run({ key: GLOBAL_PASSWORD_KEY, value: passwordHex });
}

export function clearGlobalCredentials(db: DatabaseSync): void {
  db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(GLOBAL_USERNAME_KEY, GLOBAL_PASSWORD_KEY);
}

/**
 * NextSteps.md phase 1 item 8: a fresh install should default to Panasonic's
 * own factory admin login (dispadmin / @Panasonic — published in the
 * projector's manuals, not a secret this app is leaking) rather than nothing
 * configured. Only seeds if no global default is set yet, so it never
 * overwrites an operator's own credentials — including on every future
 * startup of an install that already has some configured.
 */
const FACTORY_DEFAULT_USERNAME = 'dispadmin';
const FACTORY_DEFAULT_PASSWORD = '@Panasonic';

export function ensureDefaultCredentials(db: DatabaseSync): void {
  if (getGlobalCredentials(db) !== null) return;
  setGlobalCredentials(db, { username: FACTORY_DEFAULT_USERNAME, password: FACTORY_DEFAULT_PASSWORD });
}

/**
 * The username alone, regardless of whether a password is also set — used
 * for the settings UI's status display, which wants to show "admin1 (no
 * password set)" rather than nothing at all during a half-finished setup.
 */
export function getGlobalUsername(db: DatabaseSync): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(GLOBAL_USERNAME_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

interface DeviceCredentialRow {
  username: string | null;
  password_enc: Buffer | null;
}

/**
 * Resolves the credentials to use for one device: its own override for
 * whichever of username/password it sets, falling back to the global default
 * for the rest. Returns null if the result would be incomplete (e.g. a
 * device-only username with no global password configured to fall back to)
 * — callers must treat that as "not configured" rather than guessing.
 */
export function getDeviceCredentials(db: DatabaseSync, deviceId: number): NtControlCredentials | null {
  const row = db.prepare('SELECT username, password_enc FROM devices WHERE id = ?').get(deviceId) as
    | DeviceCredentialRow
    | undefined;
  if (!row) return null;

  const global = getGlobalCredentials(db);

  const username = row.username ?? global?.username ?? null;
  const password = row.password_enc ? decryptSecret(row.password_enc) : (global?.password ?? null);

  if (!username || !password) return null;
  return { username, password };
}

/**
 * Sets a per-device override. Pass `null` for either field to clear that
 * half back to inheriting the global default.
 */
export function setDeviceCredentials(
  db: DatabaseSync,
  deviceId: number,
  credentials: { username?: string | null; password?: string | null },
): void {
  const sets: string[] = [];
  const params: Record<string, number | string | Buffer | null> = { id: deviceId };

  if (credentials.username !== undefined) {
    sets.push('username = @username');
    params.username = credentials.username;
  }
  if (credentials.password !== undefined) {
    sets.push('password_enc = @passwordEnc');
    params.passwordEnc = credentials.password === null ? null : encryptSecret(credentials.password);
  }
  if (sets.length === 0) return;

  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  db.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE id = @id`).run(params);
}
