import type { DatabaseSync } from 'node:sqlite';
import type {
  CommandParamKind,
  ProjectActionRef,
  ProjectCommand,
  ProjectDevice,
  ProjectFile,
  ProjectGroup,
  ProjectImportResult,
  ProjectMacro,
  ProjectSchedule,
  ProjectTargetRef,
  ProjectTrigger,
} from '@ppc/shared';
import { withTransaction } from '../db/transaction.js';
import { addEdge, canReach, loadMacroCallGraph } from '../macros/cycle.js';

/**
 * Save/load a whole configuration to a portable JSON file (NextSteps.md
 * phase 1 item 3). Every cross-table reference uses a stable natural key
 * (device host:port, group/macro name, command key) instead of a numeric
 * database id, since ids are meaningless once imported elsewhere — or even
 * back into the same database after a reseed. Credentials are never
 * exported; re-entering the admin login on a fresh install is a small price
 * for a project file that's safe to email or commit.
 */

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

interface DeviceRow {
  id: number;
  name: string;
  host: string;
  port: number;
  location: string | null;
  notes: string | null;
  poll_interval_sec: number | null;
}

interface GroupRow {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
}

interface CommandRow {
  id: number;
  key: string;
  label: string;
  category: string;
  body: string;
  is_query: number;
  param_kind: CommandParamKind;
  param_options: string | null;
  param_min: number | null;
  param_max: number | null;
  favourite: number;
  sort_order: number;
  description: string | null;
}

interface MacroRow {
  id: number;
  name: string;
  description: string | null;
  colour: string | null;
  icon: string | null;
  sort_order: number;
}

interface MacroStepRow {
  seq: number;
  step_kind: 'command' | 'macro';
  command_id: number | null;
  child_macro_id: number | null;
  param: string | null;
  delay_ms_after: number;
  target_kind: 'device' | 'group' | 'all' | null;
  target_id: number | null;
}

interface ScheduleRow {
  name: string;
  cron: string;
  timezone: string | null;
  enabled: number;
  target_kind: 'device' | 'group' | 'all';
  target_id: number | null;
  action_kind: 'command' | 'macro';
  action_id: number;
  param: string | null;
}

interface TriggerRow {
  trigger_key: string;
  description: string | null;
  enabled: number;
  target_kind: 'device' | 'group' | 'all';
  target_id: number | null;
  action_kind: 'command' | 'macro';
  action_id: number;
  param: string | null;
}

function targetRefFromRow(db: DatabaseSync, kind: 'device' | 'group' | 'all', id: number | null): ProjectTargetRef {
  if (kind === 'all' || id === null) return { kind: 'all' };
  if (kind === 'group') {
    const row = db.prepare('SELECT name FROM groups WHERE id = ?').get(id) as { name: string } | undefined;
    return row ? { kind: 'group', groupName: row.name } : { kind: 'all' };
  }
  const row = db.prepare('SELECT host, port FROM devices WHERE id = ?').get(id) as
    | { host: string; port: number }
    | undefined;
  return row ? { kind: 'device', host: row.host, port: row.port } : { kind: 'all' };
}

function actionRefFromRow(
  db: DatabaseSync,
  kind: 'command' | 'macro',
  id: number,
  commandKeyById: Map<number, string>,
): ProjectActionRef {
  if (kind === 'macro') {
    const row = db.prepare('SELECT name FROM macros WHERE id = ?').get(id) as { name: string } | undefined;
    return { kind: 'macro', macroName: row?.name ?? `#${id}` };
  }
  return { kind: 'command', commandKey: commandKeyById.get(id) ?? `#${id}` };
}

export function exportProject(db: DatabaseSync): ProjectFile {
  const deviceRows = db
    .prepare('SELECT id, name, host, port, location, notes, poll_interval_sec FROM devices ORDER BY name')
    .all() as unknown as DeviceRow[];

  const groupNamesByDevice = new Map<number, string[]>();
  const links = db
    .prepare('SELECT dg.device_id AS device_id, g.name AS name FROM device_groups dg JOIN groups g ON g.id = dg.group_id')
    .all() as unknown as { device_id: number; name: string }[];
  for (const link of links) {
    const list = groupNamesByDevice.get(link.device_id) ?? [];
    list.push(link.name);
    groupNamesByDevice.set(link.device_id, list);
  }

  const devices: ProjectDevice[] = deviceRows.map((d) => ({
    name: d.name,
    host: d.host,
    port: d.port,
    location: d.location,
    notes: d.notes,
    pollIntervalSec: d.poll_interval_sec,
    groupNames: groupNamesByDevice.get(d.id) ?? [],
  }));

  const groupRows = db.prepare('SELECT id, name, description, sort_order FROM groups ORDER BY sort_order, name').all() as unknown as GroupRow[];
  const groups: ProjectGroup[] = groupRows.map((g) => ({ name: g.name, description: g.description, sortOrder: g.sort_order }));

  const commandRows = db
    .prepare('SELECT * FROM commands WHERE built_in = 0 ORDER BY category, sort_order')
    .all() as unknown as CommandRow[];
  const commands: ProjectCommand[] = commandRows.map((c) => ({
    key: c.key,
    label: c.label,
    category: c.category,
    body: c.body,
    isQuery: c.is_query === 1,
    paramKind: c.param_kind,
    paramOptions: c.param_options ? JSON.parse(c.param_options) : null,
    paramMin: c.param_min,
    paramMax: c.param_max,
    favourite: c.favourite === 1,
    sortOrder: c.sort_order,
    description: c.description,
  }));

  const commandKeyById = new Map<number, string>(
    (db.prepare('SELECT id, key FROM commands').all() as unknown as { id: number; key: string }[]).map((r) => [r.id, r.key]),
  );
  const macroNameById = new Map<number, string>(
    (db.prepare('SELECT id, name FROM macros').all() as unknown as { id: number; name: string }[]).map((r) => [r.id, r.name]),
  );

  const macroRows = db.prepare('SELECT * FROM macros ORDER BY sort_order, name').all() as unknown as MacroRow[];
  const macros: ProjectMacro[] = macroRows.map((m) => {
    const stepRows = db
      .prepare('SELECT seq, step_kind, command_id, child_macro_id, param, delay_ms_after, target_kind, target_id FROM macro_steps WHERE macro_id = ? ORDER BY seq')
      .all(m.id) as unknown as MacroStepRow[];
    return {
      name: m.name,
      description: m.description,
      colour: m.colour,
      icon: m.icon,
      sortOrder: m.sort_order,
      steps: stepRows
        .map((s) => {
          const action: ProjectActionRef | null =
            s.step_kind === 'macro'
              ? s.child_macro_id !== null && macroNameById.has(s.child_macro_id)
                ? { kind: 'macro', macroName: macroNameById.get(s.child_macro_id)! }
                : null
              : s.command_id !== null && commandKeyById.has(s.command_id)
                ? { kind: 'command', commandKey: commandKeyById.get(s.command_id)! }
                : null;
          return action && { action, param: s.param, delayMsAfter: s.delay_ms_after, target: s.target_kind ? targetRefFromRow(db, s.target_kind, s.target_id) : null };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null),
    };
  });

  const scheduleRows = db.prepare('SELECT * FROM scheduled_tasks ORDER BY name').all() as unknown as ScheduleRow[];
  const schedules: ProjectSchedule[] = scheduleRows.map((s) => ({
    name: s.name,
    cron: s.cron,
    timezone: s.timezone,
    enabled: s.enabled === 1,
    target: targetRefFromRow(db, s.target_kind, s.target_id),
    action: actionRefFromRow(db, s.action_kind, s.action_id, commandKeyById),
    param: s.param,
  }));

  const triggerRows = db.prepare('SELECT * FROM external_triggers ORDER BY trigger_key').all() as unknown as TriggerRow[];
  const triggers: ProjectTrigger[] = triggerRows.map((t) => ({
    triggerKey: t.trigger_key,
    description: t.description,
    enabled: t.enabled === 1,
    target: targetRefFromRow(db, t.target_kind, t.target_id),
    action: actionRefFromRow(db, t.action_kind, t.action_id, commandKeyById),
    param: t.param,
  }));

  return {
    formatVersion: 2,
    exportedAt: new Date().toISOString(),
    appName: 'panasonic-multi-controller',
    devices,
    groups,
    commands,
    macros,
    schedules,
    triggers,
  };
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

type ResolvedTarget = { kind: 'device' | 'group' | 'all'; id: number | null };

function emptyResult(): ProjectImportResult {
  return {
    createdDeviceIds: [],
    devices: { created: 0, skipped: 0 },
    groups: { created: 0, skipped: 0 },
    commands: { created: 0, skipped: 0 },
    macros: { created: 0, skipped: 0 },
    schedules: { created: 0, skipped: 0 },
    triggers: { created: 0, skipped: 0 },
    warnings: [],
  };
}

export function importProject(db: DatabaseSync, file: ProjectFile): ProjectImportResult {
  const result = emptyResult();

  withTransaction(db, () => {
    const insertGroup = db.prepare(
      'INSERT INTO groups (name, description, sort_order) VALUES (@name, @description, @sortOrder) ON CONFLICT (name) DO NOTHING',
    );
    for (const g of file.groups) {
      const info = insertGroup.run({ name: g.name, description: g.description, sortOrder: g.sortOrder });
      if (Number(info.changes) > 0) result.groups.created++;
      else result.groups.skipped++;
    }
    const groupIdByName = new Map<string, number>(
      (db.prepare('SELECT id, name FROM groups').all() as unknown as { id: number; name: string }[]).map((r) => [r.name, r.id]),
    );

    for (const d of file.devices) {
      const existing = db.prepare('SELECT id FROM devices WHERE host = ? AND port = ?').get(d.host, d.port) as
        | { id: number }
        | undefined;
      if (existing) {
        result.devices.skipped++;
        result.warnings.push(`Device ${d.host}:${d.port} already exists — skipped`);
        continue;
      }
      const info = db
        .prepare(
          `INSERT INTO devices (name, host, port, location, notes, poll_interval_sec)
           VALUES (@name, @host, @port, @location, @notes, @pollIntervalSec)`,
        )
        .run({
          name: d.name,
          host: d.host,
          port: d.port,
          location: d.location,
          notes: d.notes,
          pollIntervalSec: d.pollIntervalSec,
        });
      const deviceId = Number(info.lastInsertRowid);
      result.devices.created++;
      result.createdDeviceIds.push(deviceId);

      for (const groupName of d.groupNames) {
        const groupId = groupIdByName.get(groupName);
        if (groupId === undefined) {
          result.warnings.push(`Device "${d.name}": group "${groupName}" not found — membership skipped`);
          continue;
        }
        db.prepare('INSERT OR IGNORE INTO device_groups (device_id, group_id) VALUES (?, ?)').run(deviceId, groupId);
      }
    }

    const insertCommand = db.prepare(`
      INSERT INTO commands
        (key, label, category, body, is_query, param_kind, param_options, param_min, param_max, profile_id, built_in, favourite, sort_order, description)
      VALUES
        (@key, @label, @category, @body, @isQuery, @paramKind, @paramOptions, @paramMin, @paramMax, NULL, 0, @favourite, @sortOrder, @description)
      ON CONFLICT (key) DO NOTHING
    `);
    for (const c of file.commands) {
      const info = insertCommand.run({
        key: c.key,
        label: c.label,
        category: c.category,
        body: c.body,
        isQuery: c.isQuery ? 1 : 0,
        paramKind: c.paramKind,
        paramOptions: c.paramOptions ? JSON.stringify(c.paramOptions) : null,
        paramMin: c.paramMin,
        paramMax: c.paramMax,
        favourite: c.favourite ? 1 : 0,
        sortOrder: c.sortOrder,
        description: c.description,
      });
      if (Number(info.changes) > 0) result.commands.created++;
      else {
        result.commands.skipped++;
        result.warnings.push(`Command key "${c.key}" already exists — skipped`);
      }
    }
    const commandIdByKey = new Map<string, number>(
      (db.prepare('SELECT id, key FROM commands').all() as unknown as { id: number; key: string }[]).map((r) => [r.key, r.id]),
    );

    function resolveTarget(t: ProjectTargetRef | null): ResolvedTarget | null {
      if (!t) return null;
      if (t.kind === 'all') return { kind: 'all', id: null };
      if (t.kind === 'group') {
        const id = groupIdByName.get(t.groupName);
        return id === undefined ? null : { kind: 'group', id };
      }
      const row = db.prepare('SELECT id FROM devices WHERE host = ? AND port = ?').get(t.host, t.port) as
        | { id: number }
        | undefined;
      return row === undefined ? null : { kind: 'device', id: row.id };
    }

    function resolveActionId(macroIdByName: Map<string, number>, action: { kind: 'command' | 'macro'; commandKey?: string; macroName?: string }): number | undefined {
      if (action.kind === 'command') return commandIdByKey.get(action.commandKey!);
      return (
        macroIdByName.get(action.macroName!) ??
        (db.prepare('SELECT id FROM macros WHERE name = ?').get(action.macroName!) as { id: number } | undefined)?.id
      );
    }

    const insertMacro = db.prepare(
      'INSERT INTO macros (name, description, colour, icon, sort_order) VALUES (@name, @description, @colour, @icon, @sortOrder)',
    );
    const deleteMacro = db.prepare('DELETE FROM macros WHERE id = ?');
    const insertStep = db.prepare(
      `INSERT INTO macro_steps (macro_id, seq, step_kind, command_id, child_macro_id, param, delay_ms_after, target_kind, target_id)
       VALUES (@macroId, @seq, @stepKind, @commandId, @childMacroId, @param, @delayMsAfter, @targetKind, @targetId)`,
    );

    // Pass 1: give every macro name in the file a real id — existing macros
    // keep theirs, new ones are created without steps yet — so pass 2 can
    // resolve a macro-call step that names a macro declared later in the
    // file (or, combined with the cycle check below, reject one that names
    // a macro that would call back into it).
    const macroIdByName = new Map<string, number>(
      (db.prepare('SELECT id, name FROM macros').all() as unknown as { id: number; name: string }[]).map((r) => [r.name, r.id]),
    );
    const newMacros: { m: ProjectMacro; id: number }[] = [];
    for (const m of file.macros) {
      if (macroIdByName.has(m.name)) {
        result.macros.skipped++;
        result.warnings.push(`Macro "${m.name}" already exists — skipped`);
        continue;
      }
      const info = insertMacro.run({ name: m.name, description: m.description, colour: m.colour, icon: m.icon, sortOrder: m.sortOrder });
      const macroId = Number(info.lastInsertRowid);
      macroIdByName.set(m.name, macroId);
      newMacros.push({ m, id: macroId });
    }

    // Pass 2: resolve each new macro's steps and insert them, rejecting
    // (with a warning, not a fatal error — same treatment as an unresolved
    // command key) any macro-call step that would close a loop, including
    // one that only exists because of another macro elsewhere in this file.
    const callGraph = loadMacroCallGraph(db);
    for (const { m, id: macroId } of newMacros) {
      const resolvedSteps = m.steps
        .map((s, seq) => {
          const target = resolveTarget(s.target);
          if (s.target && !target) {
            result.warnings.push(`Macro "${m.name}" step ${seq + 1}: target not found — step's target override was dropped`);
          }
          const targetKind = target?.kind ?? null;
          const targetId = target?.id ?? null;

          if (s.action.kind === 'macro') {
            const childId = macroIdByName.get(s.action.macroName);
            if (childId === undefined) {
              result.warnings.push(`Macro "${m.name}" step ${seq + 1}: macro "${s.action.macroName}" not found on this install — step skipped`);
              return null;
            }
            if (canReach(callGraph, childId, macroId)) {
              result.warnings.push(`Macro "${m.name}" step ${seq + 1}: calling macro "${s.action.macroName}" here would create a call loop — step skipped`);
              return null;
            }
            addEdge(callGraph, macroId, childId);
            return { stepKind: 'macro' as const, commandId: null, childMacroId: childId, param: s.param, delayMsAfter: s.delayMsAfter, targetKind, targetId };
          }

          const commandId = commandIdByKey.get(s.action.commandKey);
          if (commandId === undefined) {
            result.warnings.push(`Macro "${m.name}" step ${seq + 1}: command "${s.action.commandKey}" not found on this install — step skipped`);
            return null;
          }
          return { stepKind: 'command' as const, commandId, childMacroId: null, param: s.param, delayMsAfter: s.delayMsAfter, targetKind, targetId };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      if (resolvedSteps.length === 0) {
        try {
          deleteMacro.run(macroId);
          macroIdByName.delete(m.name);
        } catch {
          // Another macro's step already accepted an edge into this one
          // (only reachable via a hand-edited file declaring a call cycle
          // where this macro's own steps are otherwise all unresolvable) —
          // child_macro_id is ON DELETE RESTRICT, so leave the empty shell
          // rather than raising out of the whole import.
        }
        result.macros.skipped++;
        result.warnings.push(`Macro "${m.name}": none of its steps could be resolved — skipped entirely`);
        continue;
      }

      resolvedSteps.forEach((s, seq) =>
        insertStep.run({
          macroId,
          seq,
          stepKind: s.stepKind,
          commandId: s.commandId,
          childMacroId: s.childMacroId,
          param: s.param,
          delayMsAfter: s.delayMsAfter,
          targetKind: s.targetKind,
          targetId: s.targetId,
        }),
      );
      result.macros.created++;
    }

    for (const s of file.schedules) {
      const existing = db.prepare('SELECT id FROM scheduled_tasks WHERE name = ?').get(s.name) as { id: number } | undefined;
      if (existing) {
        result.schedules.skipped++;
        result.warnings.push(`Schedule "${s.name}" already exists — skipped`);
        continue;
      }
      const target = resolveTarget(s.target);
      if (!target) {
        result.schedules.skipped++;
        result.warnings.push(`Schedule "${s.name}": target not found — skipped`);
        continue;
      }
      const actionId = resolveActionId(macroIdByName, s.action.kind === 'command' ? { kind: 'command', commandKey: s.action.commandKey } : { kind: 'macro', macroName: s.action.macroName });
      if (actionId === undefined) {
        result.schedules.skipped++;
        result.warnings.push(`Schedule "${s.name}": action not found — skipped`);
        continue;
      }

      db.prepare(
        `INSERT INTO scheduled_tasks (name, cron, timezone, enabled, target_kind, target_id, action_kind, action_id, param)
         VALUES (@name, @cron, @timezone, @enabled, @targetKind, @targetId, @actionKind, @actionId, @param)`,
      ).run({
        name: s.name,
        cron: s.cron,
        timezone: s.timezone,
        enabled: s.enabled ? 1 : 0,
        targetKind: target.kind,
        targetId: target.id,
        actionKind: s.action.kind,
        actionId,
        param: s.param,
      });
      result.schedules.created++;
    }

    for (const t of file.triggers) {
      const existing = db.prepare('SELECT id FROM external_triggers WHERE trigger_key = ?').get(t.triggerKey) as
        | { id: number }
        | undefined;
      if (existing) {
        result.triggers.skipped++;
        result.warnings.push(`Trigger "${t.triggerKey}" already exists — skipped`);
        continue;
      }
      const target = resolveTarget(t.target);
      if (!target) {
        result.triggers.skipped++;
        result.warnings.push(`Trigger "${t.triggerKey}": target not found — skipped`);
        continue;
      }
      const actionId = resolveActionId(macroIdByName, t.action.kind === 'command' ? { kind: 'command', commandKey: t.action.commandKey } : { kind: 'macro', macroName: t.action.macroName });
      if (actionId === undefined) {
        result.triggers.skipped++;
        result.warnings.push(`Trigger "${t.triggerKey}": action not found — skipped`);
        continue;
      }

      db.prepare(
        `INSERT INTO external_triggers (trigger_key, description, enabled, target_kind, target_id, action_kind, action_id, param)
         VALUES (@triggerKey, @description, @enabled, @targetKind, @targetId, @actionKind, @actionId, @param)`,
      ).run({
        triggerKey: t.triggerKey,
        description: t.description,
        enabled: t.enabled ? 1 : 0,
        targetKind: target.kind,
        targetId: target.id,
        actionKind: t.action.kind,
        actionId,
        param: t.param,
      });
      result.triggers.created++;
    }
  });

  return result;
}
