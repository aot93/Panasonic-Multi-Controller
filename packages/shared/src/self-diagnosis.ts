/**
 * QVX:ERRS1 / QVX:ERRS2 self-diagnosis code table — hardware-confirmed by
 * the user (`data/logs/errorcodes.md`), not from either official source PDF.
 * Neither `panasonic-command-list.txt` nor `ptrq-connection.txt` documents
 * what these codes mean; this table is the sole source of truth for it.
 *
 * Real-hardware evidence (one capture each) showed the two fields have
 * different shapes:
 *   - `ERRS2` returned the literal active code as text, e.g. `"H001"` —
 *     directly matchable against this table (see `lookupSelfDiagnosisCode`).
 *   - `ERRS1` returned a 511-character positional field, all `'N'` except a
 *     single `'E'` at one position — evidently one character per possible
 *     U/F-prefixed condition, `'N'` meaning "normal at this position".
 *     WHICH position corresponds to WHICH code is not documented anywhere
 *     available and was not confirmed against real hardware (the unit's own
 *     on-screen self-diagnosis display wasn't cross-referenced at capture
 *     time) — see `packages/backend/src/protocol/parsers.ts`'s
 *     `parsePositionalSelfDiagnosisField`, which reports active positions
 *     without claiming to know which code they are. This table is written
 *     to support that lookup if/when a position mapping is ever confirmed,
 *     and is used directly today for whatever `ERRS2` (or any other
 *     directly-coded field) reports.
 *
 * Severity is derived from each row's own description text (containing
 * "warning" or "error"), with two judgment calls documented inline where the
 * text gives no keyword: `U090` (no keyword — treated as a warning, matching
 * its neighbouring U-codes) and `H001` (a routine maintenance reminder, not
 * a fault — treated as informational so it doesn't turn a device's health
 * red/yellow on its own). Correct this table if that judgment turns out
 * wrong once more real faults are observed.
 */

export type SelfDiagnosisSeverity = 'info' | 'warning' | 'error';

/** Which currently-tracked sensor readings are relevant context for a given code — used to decide what to log alongside it (NextSteps.md follow-up: "log the values from sensors related to the error"). */
export type SelfDiagnosisSensor = 'temperature' | 'voltage';

export interface SelfDiagnosisCodeInfo {
  /** The specific code that was matched, e.g. "U201" — for a range match, this is the queried code itself, not the range's label. */
  code: string;
  description: string;
  severity: SelfDiagnosisSeverity;
  relatedSensors: readonly SelfDiagnosisSensor[];
}

interface SelfDiagnosisTableEntry {
  description: string;
  severity: SelfDiagnosisSeverity;
  relatedSensors: readonly SelfDiagnosisSensor[];
  /** Exact codes this entry matches, e.g. ["U081"] or ["F110", "F111"]. */
  codes?: readonly string[];
  /** An inclusive numeric range sharing one letter prefix, e.g. prefix "U", 202-254 ("U202"–"U254"). */
  range?: { prefix: string; start: number; end: number };
}

const SELF_DIAGNOSIS_TABLE: readonly SelfDiagnosisTableEntry[] = [
  { codes: ['U081'], description: 'Low AC voltage warning (below 90 V)', severity: 'warning', relatedSensors: ['voltage'] },
  { codes: ['U084'], description: 'USB power supply error', severity: 'error', relatedSensors: [] },
  // No "warning"/"error" keyword in the source description — treated as a warning to match its neighbouring U-codes.
  { codes: ['U090'], description: 'Projection lens not attached', severity: 'warning', relatedSensors: [] },
  { codes: ['U201'], description: 'Intake air temperature warning', severity: 'warning', relatedSensors: ['temperature'] },
  { codes: ['U203'], description: 'Exhaust air temperature warning', severity: 'warning', relatedSensors: ['temperature'] },
  { codes: ['U255'], description: 'AC IN terminal high temperature warning', severity: 'warning', relatedSensors: ['temperature'] },
  { range: { prefix: 'U', start: 202, end: 254 }, description: 'Other high temperature warning', severity: 'warning', relatedSensors: ['temperature'] },
  { codes: ['U280'], description: 'Low temperature warning', severity: 'warning', relatedSensors: ['temperature'] },
  { codes: ['U300'], description: 'Intake air temperature error', severity: 'error', relatedSensors: ['temperature'] },
  { codes: ['U301'], description: 'Exhaust air temperature error', severity: 'error', relatedSensors: ['temperature'] },
  { codes: ['U305'], description: 'AC IN terminal high temperature error', severity: 'error', relatedSensors: ['temperature'] },
  { codes: ['U356'], description: 'Peltier temperature error', severity: 'error', relatedSensors: ['temperature'] },
  { range: { prefix: 'U', start: 302, end: 358 }, description: 'Other high temperature error', severity: 'error', relatedSensors: ['temperature'] },
  { codes: ['U380'], description: 'Low temperature error', severity: 'error', relatedSensors: ['temperature'] },
  { codes: ['F011'], description: 'Shutter error', severity: 'error', relatedSensors: [] },
  { codes: ['F015'], description: 'Luminance sensor error', severity: 'error', relatedSensors: [] },
  { range: { prefix: 'F', start: 61, end: 66 }, description: 'Light source driver communication error', severity: 'error', relatedSensors: [] },
  { codes: ['F096'], description: 'Lens mounter error', severity: 'error', relatedSensors: [] },
  { codes: ['F098'], description: 'Lens EEPROM error', severity: 'error', relatedSensors: [] },
  { codes: ['F110', 'F111'], description: 'Phosphor wheel error', severity: 'error', relatedSensors: [] },
  { range: { prefix: 'F', start: 400, end: 461 }, description: 'Light source error', severity: 'error', relatedSensors: [] },
  { range: { prefix: 'F', start: 200, end: 226 }, description: 'Fan warning', severity: 'warning', relatedSensors: [] },
  { range: { prefix: 'F', start: 250, end: 259 }, description: 'Liquid cooling pump fan error', severity: 'error', relatedSensors: [] },
  { range: { prefix: 'F', start: 300, end: 328 }, description: 'Fan error', severity: 'error', relatedSensors: [] },
  { codes: ['F380', 'F381'], description: 'Peltier driver error', severity: 'error', relatedSensors: [] },
  // Routine maintenance reminder, not a fault — informational, doesn't drive health to warning/error.
  { codes: ['H001'], description: 'Battery replacement for the internal clock', severity: 'info', relatedSensors: [] },
  { range: { prefix: 'H', start: 11, end: 28 }, description: 'Temperature sensor error', severity: 'error', relatedSensors: ['temperature'] },
];

/** Matches a raw code (e.g. "U201", "f066") against the table — exact codes first, then ranges. Case-insensitive; returns null if nothing matches. */
export function lookupSelfDiagnosisCode(rawCode: string): SelfDiagnosisCodeInfo | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(rawCode.trim());
  if (!match) return null;

  const prefix = match[1]!.toUpperCase();
  const digits = match[2]!;
  const number = Number.parseInt(digits, 10);
  const code = `${prefix}${digits}`;

  for (const entry of SELF_DIAGNOSIS_TABLE) {
    if (entry.codes?.some((c) => c.toUpperCase() === code)) {
      return { code, description: entry.description, severity: entry.severity, relatedSensors: entry.relatedSensors };
    }
    if (entry.range && entry.range.prefix === prefix && number >= entry.range.start && number <= entry.range.end) {
      return { code, description: entry.description, severity: entry.severity, relatedSensors: entry.relatedSensors };
    }
  }
  return null;
}
