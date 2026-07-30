import type { ProtectMode } from '@ppc/shared';

export interface NtControlCredentials {
  username: string;
  password: string;
}

export interface NtControlClientOptions {
  host: string;
  port?: number;
  /** Required unless the device turns out to be in non-protect mode. */
  credentials?: NtControlCredentials;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
}

/** What the banner told us about this specific connection. */
export interface HandshakeResult {
  protectMode: ProtectMode;
  /** Hex auth hash computed for this session; null in non-protect mode. */
  authHash: string | null;
}

/** A successfully parsed (non-error) response. */
export interface NtControlResponse {
  ok: true;
  /** Payload with the fixed "00" header stripped, e.g. "001" or "0030/0080". */
  payload: string;
}

export interface NtControlErrorResponse {
  ok: false;
  code: PanasonicErrorToken;
  /** Only set for ERRA following 3 consecutive bad passwords. */
  lockoutSeconds: number | null;
  message: string;
}

export type NtControlResult = NtControlResponse | NtControlErrorResponse;

export type PanasonicErrorToken = 'ERR1' | 'ERR2' | 'ERR3' | 'ERR4' | 'ERR5' | 'ERRA';

/**
 * Raised for anything that isn't a well-formed protocol exchange: banner we
 * don't understand, response with no terminator before timeout, socket-level
 * failure. Device-level rejections (ERR1..ERR5, ERRA) are NOT exceptions —
 * they're a normal `NtControlResult` with `ok: false`, since a caller polling
 * a fleet needs to handle "device said no" without a try/catch per device.
 */
export class NtControlProtocolError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'NtControlProtocolError';
  }
}

export class NtControlTimeoutError extends NtControlProtocolError {
  constructor(message: string) {
    super(message);
    this.name = 'NtControlTimeoutError';
  }
}
