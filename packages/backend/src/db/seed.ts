import type { DatabaseSync } from 'node:sqlite';
import {
  ASPECT_OPTIONS,
  BACK_COLOR_OPTIONS,
  DAYLIGHT_VIEW_OPTIONS,
  INPUT_OPTIONS,
  ON_SCREEN_OPTIONS,
  OSD_POSITION_OPTIONS,
  PICTURE_MODE_OPTIONS,
  PROJECTION_METHOD_OPTIONS,
  QUAD_PIXEL_DRIVE_OPTIONS,
  SCREEN_SETTING_OPTIONS,
  SHUTTER_FADE_OPTIONS,
  STARTUP_LOGO_OPTIONS,
  TEST_PATTERN_OPTIONS,
} from '@ppc/shared';
import { withTransaction } from './transaction.js';

interface SeedCommand {
  key: string;
  label: string;
  category: string;
  body: string;
  isQuery?: boolean;
  paramKind?: 'none' | 'enum' | 'integer' | 'string';
  paramOptions?: readonly { readonly value: string; readonly label: string }[];
  paramMin?: number;
  paramMax?: number;
  favourite?: boolean;
  description?: string;
}

/**
 * The commands every profile gets. Bodies are verified against the official
 * RQ35K/RZ34K control command list (docs/panasonic-command-list.txt).
 *
 * Seeded as `built_in = 1`. Operators may edit or hide these and add their own
 * rows; re-seeding never clobbers an existing key.
 */
const COMMANDS: SeedCommand[] = [
  // Power
  { key: 'power.on', label: 'Power On', category: 'Power', body: 'PON', favourite: true },
  { key: 'power.off', label: 'Power Off', category: 'Power', body: 'POF', favourite: true },
  { key: 'power.query', label: 'Query Power', category: 'Power', body: 'QPW', isQuery: true },

  // Shutter. OSH:1 closes (blanks); OSH:0 opens.
  { key: 'shutter.close', label: 'Shutter Close', category: 'Shutter', body: 'OSH:1', favourite: true },
  { key: 'shutter.open', label: 'Shutter Open', category: 'Shutter', body: 'OSH:0', favourite: true },
  { key: 'shutter.query', label: 'Query Shutter', category: 'Shutter', body: 'QSH', isQuery: true },

  // Input
  {
    key: 'input.set',
    label: 'Select Input',
    category: 'Input',
    body: 'IIS:{p}',
    paramKind: 'enum',
    paramOptions: INPUT_OPTIONS,
    favourite: true,
    description: 'Available inputs vary by model and fitted slot cards.',
  },
  { key: 'input.query', label: 'Query Input', category: 'Input', body: 'QIN', isQuery: true },

  // Test pattern
  {
    key: 'testpattern.set',
    label: 'Test Pattern',
    category: 'Test Pattern',
    body: 'OTS:{p}',
    paramKind: 'enum',
    paramOptions: TEST_PATTERN_OPTIONS,
  },
  { key: 'testpattern.query', label: 'Query Test Pattern', category: 'Test Pattern', body: 'QTS', isQuery: true },

  // Aspect ratio
  {
    key: 'aspect.set',
    label: 'Set Aspect Ratio',
    category: 'Geometry',
    body: 'VSE:{p}',
    paramKind: 'enum',
    paramOptions: ASPECT_OPTIONS,
  },
  { key: 'aspect.query', label: 'Query Aspect Ratio', category: 'Geometry', body: 'QSE', isQuery: true },

  // Screen setting
  {
    key: 'screen.set',
    label: 'Set Screen Setting',
    category: 'Geometry',
    body: 'VSF:{p}',
    paramKind: 'enum',
    paramOptions: SCREEN_SETTING_OPTIONS,
  },
  { key: 'screen.query', label: 'Query Screen Setting', category: 'Geometry', body: 'QSF', isQuery: true },

  // Picture mode — NextSteps.md phase 1 item 9
  {
    key: 'picturemode.set',
    label: 'Set Picture Mode',
    category: 'Picture',
    body: 'VPM:{p}',
    paramKind: 'enum',
    paramOptions: PICTURE_MODE_OPTIONS,
    favourite: true,
  },
  { key: 'picturemode.query', label: 'Query Picture Mode', category: 'Picture', body: 'QPM', isQuery: true },

  // Monitoring
  { key: 'temp.intake.query', label: 'Query Intake Temp', category: 'Status', body: 'QTM:0', isQuery: true },
  { key: 'temp.exhaust.query', label: 'Query Exhaust Temp', category: 'Status', body: 'QTM:1', isQuery: true },
  {
    key: 'lamp.hours.query',
    label: 'Query Lamp Hours',
    category: 'Status',
    body: 'Q$L:{p}',
    isQuery: true,
    paramKind: 'integer',
    paramMin: 1,
    paramMax: 4,
    description: 'Parameter is the 1-based lamp / light source index.',
  },
  { key: 'lamp.status.query', label: 'Query Lamp Status', category: 'Status', body: 'Q$S', isQuery: true },
  { key: 'runtime.query', label: 'Query Projector Runtime', category: 'Status', body: 'QVX:RTMS1', isQuery: true },
  { key: 'id.model.query', label: 'Query Model Name', category: 'Status', body: 'QID', isQuery: true },
  { key: 'id.serial.query', label: 'Query Serial Number', category: 'Status', body: 'QSN', isQuery: true },
  { key: 'selfdiag.query.1', label: 'Query Self Diagnosis 1', category: 'Status', body: 'QVX:ERRS1', isQuery: true },
  { key: 'selfdiag.query.2', label: 'Query Self Diagnosis 2', category: 'Status', body: 'QVX:ERRS2', isQuery: true },
  {
    key: 'voltage.query',
    label: 'Query AC Voltage',
    category: 'Status',
    body: 'QVX:VMOI2',
    isQuery: true,
    description: 'Not in the official command list under this name — see docs/protocol-notes.md.',
  },

  // NextSteps.md phase 3 items 3-10
  {
    key: 'logo.set',
    label: 'Set Startup Logo',
    category: 'Display',
    body: 'MLO:{p}',
    paramKind: 'enum',
    paramOptions: STARTUP_LOGO_OPTIONS,
  },
  { key: 'logo.query', label: 'Query Startup Logo', category: 'Display', body: 'QLO', isQuery: true },

  {
    key: 'backcolor.set',
    label: 'Set Back Color',
    category: 'Display',
    body: 'OBC:{p}',
    paramKind: 'enum',
    paramOptions: BACK_COLOR_OPTIONS,
    description: 'Shown when no signal is present.',
  },
  { key: 'backcolor.query', label: 'Query Back Color', category: 'Display', body: 'QBC', isQuery: true },

  {
    key: 'shutter.fadein.set',
    label: 'Set Shutter Fade In',
    category: 'Shutter',
    body: 'VXX:SEFS1={p}',
    paramKind: 'enum',
    paramOptions: SHUTTER_FADE_OPTIONS,
  },
  { key: 'shutter.fadein.query', label: 'Query Shutter Fade In', category: 'Shutter', body: 'QVX:SEFS1', isQuery: true },

  {
    key: 'shutter.fadeout.set',
    label: 'Set Shutter Fade Out',
    category: 'Shutter',
    body: 'VXX:SEFS2={p}',
    paramKind: 'enum',
    paramOptions: SHUTTER_FADE_OPTIONS,
  },
  { key: 'shutter.fadeout.query', label: 'Query Shutter Fade Out', category: 'Shutter', body: 'QVX:SEFS2', isQuery: true },

  {
    key: 'onscreen.set',
    label: 'Set On Screen Display',
    category: 'Display',
    body: 'OOS:{p}',
    paramKind: 'enum',
    paramOptions: ON_SCREEN_OPTIONS,
    description: 'Master on-screen-display (OSD) visibility — distinct from OSD position.',
  },
  { key: 'onscreen.query', label: 'Query On Screen Display', category: 'Display', body: 'QOS', isQuery: true },

  {
    key: 'quadpixeldrive.set',
    label: 'Set Quad Pixel Drive',
    category: 'Display',
    body: 'VXX:QPDI1={p}',
    paramKind: 'enum',
    paramOptions: QUAD_PIXEL_DRIVE_OPTIONS,
    description: 'RQ35K/SRQ35KC series only — not available on RZ34K series.',
  },
  { key: 'quadpixeldrive.query', label: 'Query Quad Pixel Drive', category: 'Display', body: 'QVX:QPDI1', isQuery: true },

  {
    key: 'projectionmethod.set',
    label: 'Set Projection Method',
    category: 'Installation',
    body: 'OIL:{p}',
    paramKind: 'enum',
    paramOptions: PROJECTION_METHOD_OPTIONS,
  },
  { key: 'projectionmethod.query', label: 'Query Projection Method', category: 'Installation', body: 'QSP', isQuery: true },

  {
    key: 'installation.query',
    label: 'Query Installation Attitude',
    category: 'Installation',
    body: 'QVX:ADRI1',
    isQuery: true,
    description: 'Detected mounting attitude (floor/ceiling/vertical/portrait) — read-only, no set command exists.',
  },

  {
    key: 'osdposition.set',
    label: 'Set OSD Position',
    category: 'Display',
    body: 'ODP:{p}',
    paramKind: 'enum',
    paramOptions: OSD_POSITION_OPTIONS,
  },
  { key: 'osdposition.query', label: 'Query OSD Position', category: 'Display', body: 'QDP', isQuery: true },

  {
    key: 'daylightview.set',
    label: 'Set Daylight View',
    category: 'Installation',
    body: 'VXX:DLVI0={p}',
    paramKind: 'enum',
    paramOptions: DAYLIGHT_VIEW_OPTIONS,
    description: 'Front-installation ambient-light picture compensation strength.',
  },
  { key: 'daylightview.query', label: 'Query Daylight View', category: 'Installation', body: 'QVX:DLVI0', isQuery: true },
];

/**
 * Two built-in profiles reflecting the hardware actually in the reference
 * scripts: the older four-lamp 20K units and the current laser RQ35/RZ34 line.
 * `lamp_count` is what drives how many Q$L queries the poller issues.
 */
const PROFILES = [
  {
    name: 'Panasonic (generic)',
    modelPattern: null,
    lampCount: 1,
    description: 'Default profile applied to any device whose model has not been identified.',
  },
  {
    name: 'PT-RQ35K / RZ34K series',
    modelPattern: '^PT-S?R[QZ]3[45]',
    lampCount: 1,
    description: 'Single solid-state light source. Verified against the official 2020-11 command list.',
  },
  {
    name: 'Legacy 4-lamp (20K series)',
    modelPattern: '^PT-D[ZS]?(20|21)',
    lampCount: 4,
    description: 'Four-lamp units — the poller walks Q$L:1 through Q$L:4.',
  },
];

/**
 * Idempotent. Inserts anything missing and leaves existing rows — including
 * operator edits — untouched.
 */
export function seed(db: DatabaseSync): void {
  const insertProfile = db.prepare(`
    INSERT INTO command_profiles (name, model_pattern, lamp_count, description, built_in)
    VALUES (@name, @modelPattern, @lampCount, @description, 1)
    ON CONFLICT (name) DO NOTHING
  `);

  const insertCommand = db.prepare(`
    INSERT INTO commands
      (key, label, category, body, is_query, param_kind, param_options,
       param_min, param_max, profile_id, built_in, favourite, sort_order, description)
    VALUES
      (@key, @label, @category, @body, @isQuery, @paramKind, @paramOptions,
       @paramMin, @paramMax, NULL, 1, @favourite, @sortOrder, @description)
    ON CONFLICT (key) DO NOTHING
  `);

  withTransaction(db, () => {
    for (const p of PROFILES) insertProfile.run(p);

    COMMANDS.forEach((c, i) => {
      insertCommand.run({
        key: c.key,
        label: c.label,
        category: c.category,
        body: c.body,
        isQuery: c.isQuery ? 1 : 0,
        paramKind: c.paramKind ?? 'none',
        paramOptions: c.paramOptions ? JSON.stringify(c.paramOptions) : null,
        paramMin: c.paramMin ?? null,
        paramMax: c.paramMax ?? null,
        favourite: c.favourite ? 1 : 0,
        sortOrder: i,
        description: c.description ?? null,
      });
    });
  });

  const counts = db
    .prepare('SELECT (SELECT COUNT(*) FROM commands) AS commands, (SELECT COUNT(*) FROM command_profiles) AS profiles')
    .get() as { commands: number; profiles: number };

  console.log(`[db] seed complete — ${counts.profiles} profiles, ${counts.commands} commands`);
}
