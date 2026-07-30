import { BUILT_IN_COMMANDS, lookupSelfDiagnosisCode, type SelfDiagnosisSensor, type SelfDiagnosisSeverity } from '@ppc/shared';
import { sendOnce } from '../protocol/client.js';
import type { NtControlCredentials } from '../protocol/types.js';
import {
  parseAcVoltage,
  parseAspect,
  parseDirectSelfDiagnosisCode,
  parseLampHours,
  parsePositionalSelfDiagnosisField,
  parsePower,
  parseScreenSetting,
  parseShutter,
  parseTemperature,
} from '../protocol/parsers.js';

/**
 * Queries the "initial status monitoring" set spec §4 requires: power,
 * temperature, lamp hours, aspect ratio, screen setting — plus, as of
 * NextSteps.md phase 1, input select, shutter status and AC voltage, added to
 * this same automatic cycle with the user's explicit go-ahead to send these
 * to the live fleet.
 *
 * One connection per query (via `sendOnce`), not one shared session — see
 * docs/protocol-notes.md: the projector's documented default is to hang up
 * after every single response, and nothing here knows whether a given unit
 * has [COMMAND SESSION PROLONG] enabled to allow otherwise. This is chattier
 * than a persistent connection would be, but it's the behaviour confirmed to
 * work against every unit regardless of that per-device menu setting.
 */

/**
 * One self-diagnosis condition currently active on a device, from either
 * ERRS1 (positional — `code`/`description` unidentified, only `position`
 * known) or ERRS2 (a directly-coded value, looked up against
 * shared/src/self-diagnosis.ts).
 */
export interface SelfDiagnosisFinding {
  /** Null when the code couldn't be identified — either an ERRS1 position with no known mapping, or an ERRS2 code not in the table. */
  code: string | null;
  description: string;
  severity: SelfDiagnosisSeverity;
  relatedSensors: readonly SelfDiagnosisSensor[];
  source: 'ERRS1' | 'ERRS2';
  /** 1-based, only set for an ERRS1 finding. */
  position?: number;
}

export interface PollDeviceOptions {
  host: string;
  port?: number;
  /** Null when no credentials are configured — only works against a non-protect-mode device. */
  credentials: NtControlCredentials | null;
  /** From the device's command profile — how many Q$L indices to walk. */
  lampCount: number;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
}

export interface PollReading {
  /**
   * True only once a fully authenticated protocol exchange succeeded (the
   * power query itself came back `ok`). A wrong password gets a clean ERRA
   * response rather than a thrown error, so this is deliberately NOT the
   * same thing as "we reached the device" — an unauthenticated device is
   * just as unusable to the rest of the app as an unreachable one, and both
   * need to surface as a problem rather than silently reporting "healthy"
   * with every field blank.
   */
  ok: boolean;
  power: 'on' | 'off' | 'unknown';
  input: string | null;
  shutter: boolean | null;
  tempIntakeC: number | null;
  tempIntakeMaxC: number | null;
  tempExhaustC: number | null;
  tempExhaustMaxC: number | null;
  aspect: string | null;
  screenSetting: string | null;
  /** Volts, from QVX:VMOI2 — see parseAcVoltage for the scale caveat. */
  acVoltageV: number | null;
  /** From QVX:ERRS1/ERRS2 — empty when nothing is currently active. See SelfDiagnosisFinding. */
  selfDiagnosis: SelfDiagnosisFinding[];
  /** One entry per lamp index that answered; a failed index is simply omitted. */
  lampHours: number[];
  latencyMs: number;
  /** Set when `ok` is false — a connection failure or a device-level rejection (ERRA, etc). */
  error: string | null;
}

export async function pollDevice(options: PollDeviceOptions): Promise<PollReading> {
  const start = Date.now();
  const base = {
    host: options.host,
    port: options.port,
    credentials: options.credentials ?? undefined,
    connectTimeoutMs: options.connectTimeoutMs,
    commandTimeoutMs: options.commandTimeoutMs,
  };

  const reading: PollReading = {
    ok: false,
    power: 'unknown',
    input: null,
    shutter: null,
    tempIntakeC: null,
    tempIntakeMaxC: null,
    tempExhaustC: null,
    tempExhaustMaxC: null,
    aspect: null,
    screenSetting: null,
    acVoltageV: null,
    selfDiagnosis: [],
    lampHours: [],
    latencyMs: 0,
    error: null,
  };

  // The power query doubles as the reachability + auth probe: if the
  // projector rejects it (wrong credentials, locked out, etc) every
  // subsequent query would fail identically, so there's nothing to gain by
  // continuing.
  let probe;
  try {
    probe = await sendOnce(base, BUILT_IN_COMMANDS['power.query']);
  } catch (err) {
    reading.error = err instanceof Error ? err.message : String(err);
    reading.latencyMs = Date.now() - start;
    return reading;
  }
  if (!probe.ok) {
    reading.error = probe.message;
    reading.latencyMs = Date.now() - start;
    return reading;
  }

  reading.ok = true;
  reading.power = parsePower(probe.payload);

  // Connectivity and auth are confirmed — best-effort the rest. A failure on
  // any one of these (a flaky read, an unsupported query on this model)
  // shouldn't discard whatever readings did succeed.
  const tryQuery = async <T>(body: string, parse: (payload: string) => T): Promise<T | null> => {
    try {
      const result = await sendOnce(base, body);
      return result.ok ? parse(result.payload) : null;
    } catch {
      return null;
    }
  };

  const intake = await tryQuery(BUILT_IN_COMMANDS['temp.intake.query'], parseTemperature);
  if (intake) {
    reading.tempIntakeC = intake.value;
    reading.tempIntakeMaxC = intake.max;
  }

  const exhaust = await tryQuery(BUILT_IN_COMMANDS['temp.exhaust.query'], parseTemperature);
  if (exhaust) {
    reading.tempExhaustC = exhaust.value;
    reading.tempExhaustMaxC = exhaust.max;
  }

  const aspect = await tryQuery(BUILT_IN_COMMANDS['aspect.query'], parseAspect);
  if (aspect !== null) reading.aspect = aspect;

  const screenSetting = await tryQuery(BUILT_IN_COMMANDS['screen.query'], parseScreenSetting);
  if (screenSetting !== null) reading.screenSetting = screenSetting;

  const input = await tryQuery(BUILT_IN_COMMANDS['input.query'], (p) => p.trim());
  if (input !== null) reading.input = input;

  const shutter = await tryQuery(BUILT_IN_COMMANDS['shutter.query'], parseShutter);
  if (shutter !== null) reading.shutter = shutter;

  const acVoltageV = await tryQuery(BUILT_IN_COMMANDS['voltage.query'], parseAcVoltage);
  // Number.isFinite, not `!== null` — parseAcVoltage can return NaN for a
  // malformed response, and storing that would poison every chart reading
  // sharing its time window (see the comment on parseAcVoltage).
  if (acVoltageV !== null && Number.isFinite(acVoltageV)) reading.acVoltageV = acVoltageV;

  const errs1 = await tryQuery(BUILT_IN_COMMANDS['selfdiag.query.1'], parsePositionalSelfDiagnosisField);
  if (errs1 !== null) {
    for (const position of errs1) {
      reading.selfDiagnosis.push({
        code: null,
        description: `Unidentified self-diagnosis condition (ERRS1 position ${position})`,
        severity: 'warning',
        relatedSensors: [],
        source: 'ERRS1',
        position,
      });
    }
  }

  const errs2 = await tryQuery(BUILT_IN_COMMANDS['selfdiag.query.2'], parseDirectSelfDiagnosisCode);
  if (errs2 !== null) {
    const info = lookupSelfDiagnosisCode(errs2);
    reading.selfDiagnosis.push(
      info
        ? { code: info.code, description: info.description, severity: info.severity, relatedSensors: info.relatedSensors, source: 'ERRS2' }
        : { code: errs2, description: `Unrecognized self-diagnosis code: ${errs2}`, severity: 'warning', relatedSensors: [], source: 'ERRS2' },
    );
  }

  for (let i = 1; i <= Math.max(0, options.lampCount); i++) {
    const hours = await tryQuery(BUILT_IN_COMMANDS['lamp.hours.query'].replace('{p}', String(i)), parseLampHours);
    if (hours !== null) reading.lampHours.push(hours);
  }

  reading.latencyMs = Date.now() - start;
  return reading;
}
