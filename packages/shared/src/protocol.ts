/**
 * Panasonic NTCONTROL protocol constants.
 *
 * Sources of truth, in order of precedence:
 *   1. PTRQ-CONNECTION.pdf (official "Control commands via LAN" appendix) —
 *      extracted to docs/ptrq-connection.txt. Authority on the handshake,
 *      framing and error format.
 *   2. rq35_rz34_command_list_1606346081.8208.pdf (official, 2020-11-11) —
 *      extracted to docs/panasonic-command-list.txt. Authority on command
 *      bodies (VSE:6, QTM:0, etc); does not cover handshake/framing at all.
 *   3. The working Python scripts at the repo root, which have been driving
 *      real fleets since 2013 — useful corroboration, but see
 *      docs/protocol-notes.md for a bug in their response parsing that this
 *      implementation deliberately does not repeat.
 *
 * NOTE: this deliberately does NOT follow the illustrative Python snippet in
 * spec §4, which the spec itself flags as unverified and which the official
 * appendix supersedes entirely. See docs/protocol-notes.md for details.
 */

/** Panasonic proprietary "Computer Control" / NTCONTROL port. */
export const NTCONTROL_PORT = 1024;

/**
 * Banner the projector sends immediately on connect (ASCII, CR-terminated):
 *   Non-protect mode:        "NTCONTROL 0"
 *   Protect mode (MD5):      "NTCONTROL 1 <8 hex chars>"
 *   Protect mode (SHA-256):  "NTCONTROL 2 <8 hex chars>"
 * The mode digit reflects that specific projector's own
 * [NETWORK SECURITY] -> [COMMAND PROTECT] setting and is detected live from
 * the banner on every connection — never assumed or stored.
 */
export const BANNER_PREFIX = 'NTCONTROL';

/** Every command and response is terminated with a bare CR (no LF). */
export const TERMINATOR = '\r';

/**
 * Two-character fixed header that precedes both the command body (on the way
 * out) and the response payload (on the way back). Confirmed by the official
 * appendix's received-data table, e.g. "00001" = "00" header + "001" (QPW: on).
 * Historically documented as a projector-ID prefix for daisy-chained serial
 * links; over TCP it is always "00".
 */
export const DEVICE_ID_PREFIX = '00';

/** The two supported protect-mode hash algorithms, keyed by banner mode digit. */
export const PROTECT_MODE_ALGORITHM = {
  1: 'md5',
  2: 'sha256',
} as const;

export type ProtectMode = 'none' | 'md5' | 'sha256';

/**
 * Panasonic error tokens, returned in place of a normal response body and
 * NOT prefixed with the "00" header (unlike a normal response).
 * `ERRA ***` is handled separately — see protocol/framing.ts — since the
 * trailing digits are a lockout duration in seconds, not part of the code.
 */
export const PANASONIC_ERRORS = {
  ERR1: 'Undefined control command',
  ERR2: 'Parameter out of range',
  ERR3: 'Busy state or no-acceptable period',
  ERR4: 'Timeout or no-acceptable period',
  ERR5: 'Wrong data length',
  ERRA: 'Password mismatch',
} as const;

/* ------------------------------------------------------------------ */
/* Built-in command bodies                                             */
/* ------------------------------------------------------------------ */

/**
 * Command bodies verified against the official RQ35K/RZ34K list.
 * `{p}` marks the substituted parameter.
 *
 * These seed the editable catalogue in SQLite — they are defaults, not a
 * closed set. Operators add rows for anything else in the PDF.
 */
export const BUILT_IN_COMMANDS = {
  /* Power — spec §4 "Power on / OFF" */
  'power.on': 'PON',
  'power.off': 'POF',
  'power.query': 'QPW',

  /* Shutter — spec §4 "Shutter open / close".
     NOTE the polarity: OSH:1 CLOSES the shutter (blanks the image). */
  'shutter.close': 'OSH:1',
  'shutter.open': 'OSH:0',
  'shutter.query': 'QSH',

  /* Input selection — spec §4 "input selection" */
  'input.set': 'IIS:{p}',
  'input.query': 'QIN',

  /* Test pattern — spec §4 "Test pattern on / off and type selection" */
  'testpattern.set': 'OTS:{p}',
  'testpattern.query': 'QTS',

  /* Aspect ratio — spec §4 "Setting of aspect ratio (HV FIT, V FIT etc..)" */
  'aspect.set': 'VSE:{p}',
  'aspect.query': 'QSE',

  /* Screen setting — spec §4 "Setting of SCREEN SETTING (16:9, 16:10 etc..)" */
  'screen.set': 'VSF:{p}',
  'screen.query': 'QSF',

  /* Monitoring — spec §4 initial status monitoring set */
  'temp.intake.query': 'QTM:0',
  'temp.exhaust.query': 'QTM:1',
  /** Lamp/light runtime hours; parameter is the 1-based lamp index. */
  'lamp.hours.query': 'Q$L:{p}',
  'lamp.status.query': 'Q$S',
  'runtime.query': 'QVX:RTMS1',

  /* Identification, used to auto-assign a command profile on discovery */
  'id.model.query': 'QID',
  'id.serial.query': 'QSN',
  'id.mac.query': 'QMA',

  /* Self-diagnosis — drives the error alerting in spec §2 */
  'selfdiag.query.1': 'QVX:ERRS1',
  'selfdiag.query.2': 'QVX:ERRS2',

  /* Picture mode — NextSteps.md phase 1 item 9 */
  'picturemode.set': 'VPM:{p}',
  'picturemode.query': 'QPM',

  /* AC input voltage — NextSteps.md phase 1 "add input voltage to the graphs".
     Response form "VMOI2=+00000".."VMOI2=+99999"; not otherwise documented in
     the official command list under this name (see docs/protocol-notes.md). */
  'voltage.query': 'QVX:VMOI2',

  /* NextSteps.md phase 3 items 3-10 — verified against docs/panasonic-command-list.txt. */
  'logo.set': 'MLO:{p}',
  'logo.query': 'QLO',
  'backcolor.set': 'OBC:{p}',
  'backcolor.query': 'QBC',
  /** Shutter fade-in duration. Not a uniform range — see SHUTTER_FADE_OPTIONS. */
  'shutter.fadein.set': 'VXX:SEFS1={p}',
  'shutter.fadein.query': 'QVX:SEFS1',
  /** Shutter fade-out duration. Same value set as fade-in. */
  'shutter.fadeout.set': 'VXX:SEFS2={p}',
  'shutter.fadeout.query': 'QVX:SEFS2',
  /** On-screen display (OSD) master on/off — distinct from OSD position, below. */
  'onscreen.set': 'OOS:{p}',
  'onscreen.query': 'QOS',
  /** RQ35K/SRQ35KC series only per the official command list — not available on RZ34K series. */
  'quadpixeldrive.set': 'VXX:QPDI1={p}',
  'quadpixeldrive.query': 'QVX:QPDI1',
  'projectionmethod.set': 'OIL:{p}',
  'projectionmethod.query': 'QSP',
  /** Detected mounting attitude — query-only, no set command exists for this. */
  'installation.query': 'QVX:ADRI1',
  'osdposition.set': 'ODP:{p}',
  'osdposition.query': 'QDP',
  'daylightview.set': 'VXX:DLVI0={p}',
  'daylightview.query': 'QVX:DLVI0',
} as const;

export type BuiltInCommandKey = keyof typeof BUILT_IN_COMMANDS;

/* ------------------------------------------------------------------ */
/* Parameter enumerations                                              */
/* ------------------------------------------------------------------ */

/** VSE / QSE — aspect ratio. */
export const ASPECT_OPTIONS = [
  { value: '0', label: 'Auto / Default' },
  { value: '1', label: 'Normal (4:3)' },
  { value: '2', label: 'Wide (16:9)' },
  { value: '5', label: 'Native (through)' },
  { value: '6', label: 'Full (HV Fit)' },
  { value: '9', label: 'H-Fit' },
  { value: '10', label: 'V-Fit' },
] as const;

/** VSF / QSF — screen setting. */
export const SCREEN_SETTING_OPTIONS = [
  { value: '0', label: '16:10' },
  { value: '1', label: '16:9' },
  { value: '2', label: '4:3' },
] as const;

/** OTS / QTS — test pattern. Abridged to the patterns AV techs actually use. */
export const TEST_PATTERN_OPTIONS = [
  { value: '00', label: 'Off' },
  { value: '01', label: 'White' },
  { value: '02', label: 'Black' },
  { value: '05', label: 'Window' },
  { value: '06', label: 'Reversed Window' },
  { value: '07', label: 'Cross Hatch' },
  { value: '08', label: 'Colour Bar (vertical)' },
  { value: '51', label: 'Colour Bar (side)' },
  { value: '59', label: '16:9 / 4:3 marker' },
  { value: '32', label: 'Focus (0%)' },
  { value: '33', label: 'Focus (50%)' },
  { value: '34', label: 'Focus (100%)' },
  { value: '78', label: 'Focus' },
  { value: '87', label: 'Circle' },
] as const;

/**
 * IIS / QIN — input selection. Full enumeration confirmed against
 * docs/panasonic-command-list.txt (NextSteps.md phase 3 item 2) —
 * previously an abridged subset. `SLOT_INPUT_TYPES`/`SLOT_INPUT_NUMBERS`/
 * `NON_SLOT_INPUT_OPTIONS`/`DIGITAL_LINK_SUB_OPTIONS` below decompose this
 * same set for the 3-part (slot / type / number) picker UI; this flat list
 * remains the source of truth for validation.
 */
export const INPUT_OPTIONS = [
  { value: 'HD1', label: 'HDMI 1' },
  { value: 'DVI', label: 'DVI-D' },
  { value: 'SD1', label: 'SDI 1' },
  { value: 'DL1', label: 'DIGITAL LINK' },
  { value: 'DL1:PC1', label: 'DIGITAL LINK — Computer 1' },
  { value: 'DL1:PC2', label: 'DIGITAL LINK — Computer 2' },
  { value: 'DL1:VID', label: 'DIGITAL LINK — Video' },
  { value: 'DL1:HD1', label: 'DIGITAL LINK — HDMI 1' },
  { value: 'DL1:HD2', label: 'DIGITAL LINK — HDMI 2' },
  { value: 'DL1:SVD', label: 'DIGITAL LINK — S-Video' },
  { value: 'AU1,SD1', label: 'Slot 1 — SDI 1' },
  { value: 'AU1,SD2', label: 'Slot 1 — SDI 2' },
  { value: 'AU1,SD3', label: 'Slot 1 — SDI 3' },
  { value: 'AU1,SD4', label: 'Slot 1 — SDI 4' },
  { value: 'AU1,HD1', label: 'Slot 1 — HDMI 1' },
  { value: 'AU1,HD2', label: 'Slot 1 — HDMI 2' },
  { value: 'AU1,DV1', label: 'Slot 1 — DVI 1' },
  { value: 'AU1,DV2', label: 'Slot 1 — DVI 2' },
  { value: 'AU1,DP1', label: 'Slot 1 — DisplayPort 1' },
  { value: 'AU1,DP2', label: 'Slot 1 — DisplayPort 2' },
  { value: 'AU1,OP1', label: 'Slot 1 — 12G SDI Optical 1' },
  { value: 'AU1,OP2', label: 'Slot 1 — 12G SDI Optical 2' },
  { value: 'AU2,SD1', label: 'Slot 2 — SDI 1' },
  { value: 'AU2,SD2', label: 'Slot 2 — SDI 2' },
  { value: 'AU2,SD3', label: 'Slot 2 — SDI 3' },
  { value: 'AU2,SD4', label: 'Slot 2 — SDI 4' },
  { value: 'AU2,HD3', label: 'Slot 2 — HDMI 3' },
  { value: 'AU2,HD4', label: 'Slot 2 — HDMI 4' },
  { value: 'AU2,DV3', label: 'Slot 2 — DVI 3' },
  { value: 'AU2,DV4', label: 'Slot 2 — DVI 4' },
  { value: 'AU2,DP3', label: 'Slot 2 — DisplayPort 3' },
  { value: 'AU2,DP4', label: 'Slot 2 — DisplayPort 4' },
  { value: 'AU2,OP1', label: 'Slot 2 — 12G SDI Optical 1' },
  { value: 'AU2,OP2', label: 'Slot 2 — 12G SDI Optical 2' },
] as const;

/**
 * Non-slot inputs, restricted to HDMI and Digital Link per NextSteps.md
 * phase 3 item 2 ("Inputs not tied to a slot should remain single items and
 * restricted to only HDMI and Digital Link") — the official list also has
 * built-in DVI-D/SDI on some models, deliberately left out of this shorter
 * picker list (still valid via `IIS:DVI`/`IIS:SD1` directly, or the custom
 * command catalogue, if a fleet needs them).
 */
export const NON_SLOT_INPUT_OPTIONS = [
  { value: 'HD1', label: 'HDMI' },
  { value: 'DL1', label: 'Digital Link (auto)' },
] as const;

/** IIS:DL1:{p} — offered as a refinement once "Digital Link" is chosen. */
export const DIGITAL_LINK_SUB_OPTIONS = [
  { value: 'DL1:PC1', label: 'Computer 1' },
  { value: 'DL1:PC2', label: 'Computer 2' },
  { value: 'DL1:VID', label: 'Video' },
  { value: 'DL1:HD1', label: 'HDMI 1' },
  { value: 'DL1:HD2', label: 'HDMI 2' },
  { value: 'DL1:SVD', label: 'S-Video' },
] as const;

/** Slot input {type} codes — the middle part of "SLOT <number> <type> <input>". */
export const SLOT_INPUT_TYPES = [
  { code: 'SD', label: 'SDI' },
  { code: 'HD', label: 'HDMI' },
  { code: 'DV', label: 'DVI' },
  { code: 'DP', label: 'DisplayPort' },
  { code: 'OP', label: '12G-SDI Optical' },
] as const;

/**
 * Valid input numbers per slot + type, confirmed against the official
 * command list — deliberately NOT symmetric between slots (e.g. slot 2's
 * HDMI/DVI/DisplayPort continue the numbering from slot 1 — "HDMI 3"/"HDMI
 * 4" — rather than restarting at 1, while SDI and 12G-SDI Optical do
 * restart at 1 on each slot).
 */
export const SLOT_INPUT_NUMBERS: Record<1 | 2, Record<string, readonly number[]>> = {
  1: { SD: [1, 2, 3, 4], HD: [1, 2], DV: [1, 2], DP: [1, 2], OP: [1, 2] },
  2: { SD: [1, 2, 3, 4], HD: [3, 4], DV: [3, 4], DP: [3, 4], OP: [1, 2] },
};

/** VPM / QPM — picture mode. */
export const PICTURE_MODE_OPTIONS = [
  { value: 'DYN', label: 'Dynamic' },
  { value: 'NAT', label: 'Natural' },
  { value: 'STD', label: 'Standard' },
  { value: 'CIN', label: 'Cinema' },
  { value: 'GRA', label: 'Graphic' },
  { value: 'DIC', label: 'DICOM Sim.' },
  { value: 'USR', label: 'User' },
] as const;

/** QPW power query responses. */
export const POWER_RESPONSES: Record<string, 'on' | 'off'> = {
  '000': 'off',
  '001': 'on',
};

/** Q$S lamp/light status responses. */
export const LAMP_STATUS_RESPONSES: Record<string, string> = {
  '0': 'off',
  '1': 'warming',
  '2': 'on',
  '3': 'cooling',
};

/** MLO / QLO — startup logo. */
export const STARTUP_LOGO_OPTIONS = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'User Logo' },
  { value: '2', label: 'Default Logo' },
] as const;

/** OBC / QBC — back color, shown when no signal is present. */
export const BACK_COLOR_OPTIONS = [
  { value: '0', label: 'Blue' },
  { value: '1', label: 'Black' },
  { value: '2', label: 'User Logo' },
  { value: '3', label: 'Default Logo' },
] as const;

/** VXX:SEFS1 / VXX:SEFS2 — shutter fade in/out duration. Not a uniform range — exactly these 12 values are valid per the official command list. */
export const SHUTTER_FADE_OPTIONS = [
  { value: '0.0', label: '0.0s (Off)' },
  { value: '0.5', label: '0.5s' },
  { value: '1.0', label: '1.0s' },
  { value: '1.5', label: '1.5s' },
  { value: '2.0', label: '2.0s' },
  { value: '2.5', label: '2.5s' },
  { value: '3.0', label: '3.0s' },
  { value: '3.5', label: '3.5s' },
  { value: '4.0', label: '4.0s' },
  { value: '5.0', label: '5.0s' },
  { value: '7.0', label: '7.0s' },
  { value: '10.0', label: '10.0s' },
] as const;

/** OOS / QOS — on-screen display (OSD) master on/off. Distinct from OSD_POSITION_OPTIONS below (menu placement, not visibility). */
export const ON_SCREEN_OPTIONS = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'On' },
] as const;

/** VXX:QPDI1 / QVX:QPDI1 — quad pixel drive. RQ35K/SRQ35KC series only per the official list; not available on RZ34K series. */
export const QUAD_PIXEL_DRIVE_OPTIONS = [
  { value: '+00000', label: 'Off' },
  { value: '+00001', label: 'On' },
] as const;

/** OIL / QSP — projection method (mounting + front/rear orientation). */
export const PROJECTION_METHOD_OPTIONS = [
  { value: '0', label: 'Front / Desk' },
  { value: '1', label: 'Rear / Desk' },
  { value: '2', label: 'Front / Ceiling' },
  { value: '3', label: 'Rear / Ceiling' },
  { value: '4', label: 'Front / Auto' },
  { value: '5', label: 'Rear / Auto' },
] as const;

/** QVX:ADRI1 — detected installation attitude. Query-only; the projector reports this (from its own orientation sensor), it isn't set remotely. */
export const INSTALLATION_RESPONSES: Record<string, string> = {
  '+00000': 'Floor',
  '+00001': 'Ceiling',
  '+00002': 'Vertical Up',
  '+00003': 'Vertical Down',
  '+00004': 'Portrait',
};

/** ODP / QDP — on-screen menu position. */
export const OSD_POSITION_OPTIONS = [
  { value: '1', label: 'Upper Left' },
  { value: '2', label: 'Centre Left' },
  { value: '3', label: 'Lower Left' },
  { value: '4', label: 'Top Center' },
  { value: '5', label: 'Center' },
  { value: '6', label: 'Lower Center' },
  { value: '7', label: 'Upper Right' },
  { value: '8', label: 'Center Right' },
  { value: '9', label: 'Lower Right' },
] as const;

/** VXX:DLVI0 / QVX:DLVI0 — daylight view (front install), ambient-light picture compensation strength. */
export const DAYLIGHT_VIEW_OPTIONS = [
  { value: '+00000', label: 'Off' },
  { value: '+00001', label: 'Auto (1)' },
  { value: '+00002', label: 'On (2)' },
  { value: '+00003', label: 'On (3)' },
  { value: '+00004', label: 'Level 4' },
  { value: '+00005', label: 'Level 5' },
  { value: '+00006', label: 'Level 6' },
] as const;
