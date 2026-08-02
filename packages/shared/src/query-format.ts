/**
 * Turns a built-in query command's raw wire response (`CommandResult.response`
 * — the fixed "00" header already stripped, e.g. "000", "6", "SEFS1=3.0")
 * into a plain-English description, e.g. "Wide (16:9)", "3.0 seconds".
 *
 * docs/NextSteps.md "Post v1 improvements" item 2: query results previously
 * showed only the raw protocol token (see `packages/backend/src/protocol/
 * parsers.ts` for the equivalent backend-side parsing used for telemetry —
 * this is the same interpretation, applied for display instead of storage).
 *
 * Keyed by `CommandDef.key`, not `body`, since that's the stable identifier
 * already used throughout the app. Only built-in query keys are recognised;
 * anything else (a custom catalogue command, or a response shape that
 * doesn't match what's expected) falls back to the raw response unchanged —
 * this only ever adds a friendlier rendering, never hides the real value.
 */

import {
  ASPECT_OPTIONS,
  BACK_COLOR_OPTIONS,
  DAYLIGHT_VIEW_OPTIONS,
  INPUT_OPTIONS,
  INSTALLATION_RESPONSES,
  LAMP_STATUS_RESPONSES,
  OSD_POSITION_OPTIONS,
  ON_SCREEN_OPTIONS,
  PICTURE_MODE_OPTIONS,
  POWER_RESPONSES,
  PROJECTION_METHOD_OPTIONS,
  QUAD_PIXEL_DRIVE_OPTIONS,
  SCREEN_SETTING_OPTIONS,
  SHUTTER_FADE_OPTIONS,
  STARTUP_LOGO_OPTIONS,
  TEST_PATTERN_OPTIONS,
} from './protocol.js';
import { lookupSelfDiagnosisCode } from './self-diagnosis.js';

function labelFor(options: readonly { value: string; label: string }[], raw: string): string {
  return options.find((o) => o.value === raw)?.label ?? raw;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** QVX:* queries respond in "KEY=value" form, e.g. "RTMS1=7864320". Null if the payload has no "=". */
function keyValue(payload: string): { key: string; value: string } | null {
  const idx = payload.indexOf('=');
  if (idx === -1) return null;
  return { key: payload.slice(0, idx), value: payload.slice(idx + 1) };
}

/** VXX:SEFS1 / VXX:SEFS2 — "0.0" is the off state, everything else is a plain duration. */
function formatFadeSeconds(value: string): string {
  return value === '0.0' ? 'Off (0.0 seconds)' : `${value} seconds`;
}

export function formatQueryResponse(commandKey: string, response: string): string {
  const raw = response.trim();

  switch (commandKey) {
    case 'power.query':
      return POWER_RESPONSES[raw] === 'on' ? 'On' : POWER_RESPONSES[raw] === 'off' ? 'Off' : raw;

    case 'shutter.query':
      return raw === '1' ? 'Closed (blanked)' : raw === '0' ? 'Open' : raw;

    case 'input.query':
      return labelFor(INPUT_OPTIONS, raw);

    case 'testpattern.query':
      return labelFor(TEST_PATTERN_OPTIONS, raw);

    case 'aspect.query':
      return labelFor(ASPECT_OPTIONS, String(Number.parseInt(raw, 10)));

    case 'screen.query':
      return labelFor(SCREEN_SETTING_OPTIONS, String(Number.parseInt(raw, 10)));

    case 'picturemode.query':
      return labelFor(PICTURE_MODE_OPTIONS, raw);

    case 'temp.intake.query':
    case 'temp.exhaust.query': {
      const [value, max] = raw.split('/');
      if (value === undefined || max === undefined) return raw;
      const v = Number.parseInt(value, 10);
      const m = Number.parseInt(max, 10);
      return Number.isFinite(v) && Number.isFinite(m) ? `${v}°C (max ${m}°C)` : raw;
    }

    case 'lamp.hours.query': {
      const hours = Number.parseInt(raw, 10);
      return Number.isFinite(hours) ? `${hours} hour${hours === 1 ? '' : 's'}` : raw;
    }

    case 'lamp.status.query':
      return raw in LAMP_STATUS_RESPONSES ? capitalize(LAMP_STATUS_RESPONSES[raw]!) : raw;

    case 'runtime.query': {
      const hours = Number.parseInt(keyValue(raw)?.value ?? raw, 10);
      return Number.isFinite(hours) ? `${hours} hour${hours === 1 ? '' : 's'}` : raw;
    }

    case 'id.mac.query':
      // "AB0102030405" -> "AB:01:02:03:04:05"
      return /^[0-9A-Fa-f]{12}$/.test(raw) ? raw.match(/.{2}/g)!.join(':').toUpperCase() : raw;

    case 'selfdiag.query.1': {
      const value = keyValue(raw)?.value ?? raw;
      const positions: number[] = [];
      for (let i = 0; i < value.length; i++) {
        if (value[i]!.toUpperCase() !== 'N') positions.push(i + 1);
      }
      if (positions.length === 0) return 'All normal';
      // Deliberately doesn't claim to know which fault each position is — see
      // shared/src/self-diagnosis.ts's file comment on why the mapping isn't known.
      return `Unidentified condition${positions.length === 1 ? '' : 's'} active (position${
        positions.length === 1 ? '' : 's'
      } ${positions.join(', ')})`;
    }

    case 'selfdiag.query.2': {
      const value = (keyValue(raw)?.value ?? raw).trim();
      if (value === '' || /^[N0]+$/i.test(value)) return 'No active self-diagnosis codes';
      const info = lookupSelfDiagnosisCode(value);
      return info ? `${info.code}: ${info.description}` : value;
    }

    case 'voltage.query': {
      const volts = Number.parseInt(keyValue(raw)?.value ?? raw, 10);
      return Number.isFinite(volts) ? `${volts} V` : raw;
    }

    case 'logo.query':
      return labelFor(STARTUP_LOGO_OPTIONS, raw);

    case 'backcolor.query':
      return labelFor(BACK_COLOR_OPTIONS, raw);

    case 'shutter.fadein.query':
    case 'shutter.fadeout.query': {
      const value = keyValue(raw)?.value ?? raw;
      return SHUTTER_FADE_OPTIONS.some((o) => o.value === value) ? formatFadeSeconds(value) : raw;
    }

    case 'onscreen.query':
      return labelFor(ON_SCREEN_OPTIONS, raw);

    case 'quadpixeldrive.query':
      return labelFor(QUAD_PIXEL_DRIVE_OPTIONS, raw);

    case 'projectionmethod.query':
      return labelFor(PROJECTION_METHOD_OPTIONS, raw);

    case 'installation.query':
      return INSTALLATION_RESPONSES[raw] ?? raw;

    case 'osdposition.query':
      return labelFor(OSD_POSITION_OPTIONS, raw);

    case 'daylightview.query':
      return labelFor(DAYLIGHT_VIEW_OPTIONS, raw);

    default:
      // id.model.query / id.serial.query already return plain human text
      // (a model name, a serial number) with nothing to translate, and any
      // custom/catalogue-added query command has no known response shape —
      // both fall through to the raw response unchanged.
      return raw;
  }
}
