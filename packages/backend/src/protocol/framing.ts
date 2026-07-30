import { createHash } from 'node:crypto';
import {
  BANNER_PREFIX,
  DEVICE_ID_PREFIX,
  PROTECT_MODE_ALGORITHM,
  TERMINATOR,
  type ProtectMode,
} from '@ppc/shared';
import type {
  NtControlCredentials,
  NtControlResult,
  HandshakeResult,
  PanasonicErrorToken,
} from './types.js';

/**
 * Pure protocol logic — no sockets, no timers. Kept isolated and unit-tested
 * on its own per the phase 2 brief, independent of the TCP client that uses
 * it and of the mock server that exercises it end to end.
 *
 * Confirmed against PTRQ-CONNECTION.pdf (docs/protocol-notes.md). Nothing
 * here should need real hardware to validate — only string/byte handling.
 */

const BANNER_RE = /^NTCONTROL (0|1|2)(?: ([0-9a-fA-F]{8}))?$/;

/**
 * Parses the banner the projector sends immediately on connect, e.g.:
 *   "NTCONTROL 0"            -> non-protect mode
 *   "NTCONTROL 1 23181e1e"   -> protect mode, MD5, challenge "23181e1e"
 *   "NTCONTROL 2 23181e1e"   -> protect mode, SHA-256
 *
 * `raw` should have the trailing CR already stripped.
 */
export function parseBanner(raw: string): { protectMode: ProtectMode; challenge: string | null } {
  const match = BANNER_RE.exec(raw.trim());
  if (!match) {
    throw new Error(`Unrecognised banner: ${JSON.stringify(raw)}. Expected "${BANNER_PREFIX} 0|1|2 [challenge]".`);
  }

  const [, modeDigit, challenge] = match;

  if (modeDigit === '0') {
    return { protectMode: 'none', challenge: null };
  }

  if (!challenge) {
    throw new Error(`Protect mode ${modeDigit} banner is missing its 8-character challenge: ${JSON.stringify(raw)}`);
  }

  const protectMode = PROTECT_MODE_ALGORITHM[modeDigit as unknown as 1 | 2];
  return { protectMode, challenge: challenge.toLowerCase() };
}

/**
 * Computes the session auth hash: MD5 or SHA-256 of "user:pass:challenge",
 * hex-encoded lowercase. Computed once per connection (from that session's
 * challenge) and reused for every command sent on it — see
 * docs/protocol-notes.md "Confirmed framing".
 */
export function computeAuthHash(
  credentials: NtControlCredentials,
  challenge: string,
  protectMode: Extract<ProtectMode, 'md5' | 'sha256'>,
): string {
  const algorithm = protectMode === 'md5' ? 'md5' : 'sha256';
  const material = `${credentials.username}:${credentials.password}:${challenge}`;
  return createHash(algorithm).update(material, 'ascii').digest('hex');
}

/**
 * Runs the handshake logic against an already-received banner. Returns the
 * hash to prepend to every command this session, or null if the device is in
 * non-protect mode (in which case commands carry no hash at all).
 */
export function handshake(banner: string, credentials?: NtControlCredentials): HandshakeResult {
  const { protectMode, challenge } = parseBanner(banner);

  if (protectMode === 'none') {
    return { protectMode, authHash: null };
  }

  if (!credentials) {
    throw new Error(
      `Device requires ${protectMode.toUpperCase()} authentication but no credentials were supplied.`,
    );
  }

  return { protectMode, authHash: computeAuthHash(credentials, challenge!, protectMode) };
}

/**
 * Builds the frame to send on the wire: `<hash?><"00"><body><CR>`.
 * `authHash` is null in non-protect mode, in which case no hash is prepended.
 */
export function buildCommandFrame(body: string, authHash: string | null): string {
  return `${authHash ?? ''}${DEVICE_ID_PREFIX}${body}${TERMINATOR}`;
}

const ERROR_RE = /^(ERR[1-5]|ERRA)(?:\s+(\d+))?$/;

const ERROR_MESSAGES: Record<string, string> = {
  ERR1: 'Undefined control command',
  ERR2: 'Parameter out of range',
  ERR3: 'Busy state or no-acceptable period',
  ERR4: 'Timeout or no-acceptable period',
  ERR5: 'Wrong data length',
  ERRA: 'Password mismatch',
};

/**
 * Parses one CR-terminated response frame (CR already stripped by the
 * caller's frame reader).
 *
 * Error responses (ERR1-ERR5, ERRA[, lockout seconds]) carry NO "00" header.
 * Normal responses do — exactly 2 characters, stripped unconditionally
 * regardless of what they contain, which is the fix for the old scripts'
 * `lstrip('000')` bug: that approach would blank out a legitimate "00000"
 * (off) response entirely instead of leaving "000".
 */
export function parseResponseFrame(raw: string): NtControlResult {
  const trimmed = raw.trim();

  const errorMatch = ERROR_RE.exec(trimmed);
  if (errorMatch) {
    // Group 1 is mandatory in ERROR_RE, so it's always present when the
    // overall match succeeds — noUncheckedIndexedAccess just can't see that.
    const code = errorMatch[1]!;
    const lockout = errorMatch[2];
    const isLockout = code === 'ERRA' && lockout !== undefined;
    return {
      ok: false,
      code: code as PanasonicErrorToken,
      lockoutSeconds: isLockout ? Number(lockout) : null,
      message: isLockout
        ? `Password mismatch — access blocked for ${lockout}s after repeated failures`
        // code is one of ERROR_RE's fixed alternatives, so it's always a key
        // of ERROR_MESSAGES — noUncheckedIndexedAccess just can't see that.
        : ERROR_MESSAGES[code]!,
    };
  }

  if (trimmed.length < 2) {
    throw new Error(`Response too short to contain the fixed "00" header: ${JSON.stringify(raw)}`);
  }

  return { ok: true, payload: trimmed.slice(2) };
}
