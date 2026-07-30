import { LAMP_STATUS_RESPONSES, POWER_RESPONSES } from '@ppc/shared';

/**
 * Interprets the `payload` already returned by `parseResponseFrame` (i.e. with
 * the fixed "00" header already stripped) for the specific queries spec §4
 * lists as required initial status monitoring: power, temperature, lamp
 * hours, aspect ratio, screen setting.
 *
 * Values in docs/panasonic-command-list.txt are shown post-header-stripped —
 * that table documents command *semantics*, while PTRQ-CONNECTION.pdf
 * documents wire *framing*. The two reconcile exactly at this boundary: what
 * this file's inputs look like is what that table shows in its "CALL BACK"
 * column.
 */

export function parsePower(payload: string): 'on' | 'off' | 'unknown' {
  return POWER_RESPONSES[payload] ?? 'unknown';
}

export function parseLampStatus(payload: string): string {
  return LAMP_STATUS_RESPONSES[payload] ?? 'unknown';
}

export interface TemperatureReading {
  /** Degrees Celsius. */
  value: number;
  /** Manufacturer warning threshold in degrees Celsius, from the same field. */
  max: number;
}

/** QTM:0 / QTM:1 — fixed-width "value/max" pair, e.g. "0030/0080". */
export function parseTemperature(payload: string): TemperatureReading {
  const [value, max] = payload.split('/');
  if (value === undefined || max === undefined) {
    throw new Error(`Malformed temperature payload: ${JSON.stringify(payload)}`);
  }
  return { value: Number.parseInt(value, 10), max: Number.parseInt(max, 10) };
}

/** Q$L:n — lamp/light source runtime hours, e.g. "9999". */
export function parseLampHours(payload: string): number {
  return Number.parseInt(payload, 10);
}

/** QSE — aspect ratio token, e.g. "6". Matches ASPECT_OPTIONS values verbatim. */
export function parseAspect(payload: string): string {
  return String(Number.parseInt(payload, 10));
}

/** QSF — screen setting token, e.g. "0". Matches SCREEN_SETTING_OPTIONS values. */
export function parseScreenSetting(payload: string): string {
  return String(Number.parseInt(payload, 10));
}

/**
 * QVX:* queries respond in "KEY=value" form, e.g. "RTMS1=7864320" or
 * "ERRS1=*****". Splits once on the first "=".
 */
export function parseKeyValue(payload: string): { key: string; value: string } {
  const idx = payload.indexOf('=');
  if (idx === -1) {
    throw new Error(`Expected "KEY=value" payload, got: ${JSON.stringify(payload)}`);
  }
  return { key: payload.slice(0, idx), value: payload.slice(idx + 1) };
}

/** QSH — shutter status: "1" closed (blanked), "0" open. */
export function parseShutter(payload: string): boolean {
  return payload.trim() === '1';
}

/**
 * QVX:ERRS2 — confirmed against real hardware to return the literal active
 * self-diagnosis code as text (e.g. "H001"), not a bitfield — see
 * shared/src/self-diagnosis.ts for provenance and the code table. Returns
 * null for "nothing active": blank, all zeros, or all 'N' (the healthy
 * baseline wasn't directly confirmed against a real unit, so all three are
 * treated as equivalent rather than guessing one specific sentinel).
 */
export function parseDirectSelfDiagnosisCode(payload: string): string | null {
  const { value } = parseKeyValue(payload);
  const trimmed = value.trim();
  if (trimmed === '' || /^[N0]+$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * QVX:ERRS1 — confirmed against real hardware to be a long fixed-width
 * positional field: 'N' means normal at that position, anything else means
 * some condition is active there. One real capture was 511 characters, all
 * 'N' except a single 'E' at position 152.
 *
 * WHICH U/F-prefixed code a given position represents is not documented in
 * either official source PDF and was not confirmed against real hardware
 * (the unit's own on-screen self-diagnosis display wasn't cross-referenced
 * at capture time) — so this deliberately only reports which positions are
 * active, not what they mean. 1-based, matching how a human would reference
 * "position 152". See shared/src/self-diagnosis.ts's file comment.
 */
export function parsePositionalSelfDiagnosisField(payload: string): number[] {
  const { value } = parseKeyValue(payload);
  const positions: number[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i]!.toUpperCase() !== 'N') positions.push(i + 1);
  }
  return positions;
}

/**
 * QVX:VMOI2 — AC input voltage, response form "VMOI2=+00000".."VMOI2=+99999".
 * Not in the official command list under this name; see docs/protocol-notes.md
 * for provenance. The raw integer is whole volts, no scaling — confirmed
 * against three real units reading "VMOI2=+00238"/"+00239" (238V/239V, a
 * plausible mains reading; the initially-assumed centivolts scale, dividing
 * by 100, would have shown ~2.4V, which real-hardware testing caught).
 *
 * Returns NaN if the payload doesn't parse (e.g. an unexpectedly blank or
 * non-numeric value field) — callers must check `Number.isFinite()` rather
 * than treating any non-null result as usable, so a single malformed
 * response can't poison stored telemetry with a NaN that then breaks every
 * chart reading it shares a time window with (Math.min/max propagate NaN
 * across an entire array, not just the one bad point).
 */
export function parseAcVoltage(payload: string): number {
  const { value } = parseKeyValue(payload);
  return Number.parseInt(value, 10);
}
