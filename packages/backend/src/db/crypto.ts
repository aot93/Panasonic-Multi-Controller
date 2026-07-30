import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { SECRET_KEY_PATH, ensureDataDir } from '../config.js';

/**
 * Projector admin passwords are stored encrypted rather than in plaintext.
 *
 * Scope of protection, stated honestly: the key sits next to the database on
 * the same machine, so this defends against the database file being copied,
 * emailed or backed up somewhere careless — not against an attacker who
 * already has the host. That is the realistic threat for an on-site AV box,
 * and matching plaintext-in-SQLite would be strictly worse.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.PPC_SECRET_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'hex');
    if (key.length !== 32) {
      throw new Error('PPC_SECRET_KEY must be 32 bytes encoded as 64 hex characters.');
    }
    cachedKey = key;
    return key;
  }

  ensureDataDir();
  if (existsSync(SECRET_KEY_PATH)) {
    cachedKey = Buffer.from(readFileSync(SECRET_KEY_PATH, 'utf8').trim(), 'hex');
    return cachedKey;
  }

  const key = randomBytes(32);
  writeFileSync(SECRET_KEY_PATH, key.toString('hex'), { mode: 0o600 });
  try {
    chmodSync(SECRET_KEY_PATH, 0o600);
  } catch {
    // Windows ignores POSIX modes; the file inherits directory ACLs.
  }
  cachedKey = key;
  return key;
}

/** Returns iv || authTag || ciphertext as a single buffer for BLOB storage. */
export function encryptSecret(plaintext: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(blob: Buffer | null): string | null {
  if (!blob || blob.length < IV_LENGTH + TAG_LENGTH) return null;
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
