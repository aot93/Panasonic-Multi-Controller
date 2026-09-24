import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { exportProject, importProject } from './export-import.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  seed(db);
  return db;
}

test('exportProject: empty database exports empty arrays', () => {
  const db = makeDb();
  const file = exportProject(db);
  assert.equal(file.formatVersion, 2);
  assert.deepEqual(file.devices, []);
  assert.deepEqual(file.groups, []);
  assert.deepEqual(file.commands, []);
  assert.deepEqual(file.macros, []);
});

test('exportProject: only custom (non-built-in) commands are included', () => {
  const db = makeDb();
  db.prepare(
    `INSERT INTO commands (key, label, category, body, is_query, param_kind, built_in)
     VALUES ('custom.one', 'Custom One', 'Custom', 'NCGS0=1', 0, 'none', 0)`,
  ).run();
  const file = exportProject(db);
  assert.equal(file.commands.length, 1);
  assert.equal(file.commands[0]?.key, 'custom.one');
});

test('export then import into a fresh database recreates devices, groups and membership', () => {
  const source = makeDb();
  const groupId = Number(source.prepare('INSERT INTO groups (name, sort_order) VALUES (?, ?)').run('Ground Floor', 0).lastInsertRowid);
  const deviceId = Number(
    source.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '192.168.0.101', 1024).lastInsertRowid,
  );
  source.prepare('INSERT INTO device_groups (device_id, group_id) VALUES (?, ?)').run(deviceId, groupId);

  const file = exportProject(source);
  assert.equal(file.devices.length, 1);
  assert.deepEqual(file.devices[0]?.groupNames, ['Ground Floor']);

  const target = makeDb();
  const result = importProject(target, file);

  assert.equal(result.devices.created, 1);
  assert.equal(result.groups.created, 1);
  assert.equal(result.createdDeviceIds.length, 1);

  const row = target.prepare('SELECT id, name FROM devices WHERE host = ?').get('192.168.0.101') as { id: number; name: string };
  assert.equal(row.name, 'Foyer');
  const membership = target
    .prepare('SELECT g.name FROM device_groups dg JOIN groups g ON g.id = dg.group_id WHERE dg.device_id = ?')
    .get(row.id) as { name: string };
  assert.equal(membership.name, 'Ground Floor');
});

test('import is additive: re-importing the same file a second time skips everything', () => {
  const source = makeDb();
  source.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '192.168.0.101', 1024);
  source.prepare('INSERT INTO groups (name) VALUES (?)').run('Ground Floor');
  const file = exportProject(source);

  const target = makeDb();
  const first = importProject(target, file);
  assert.equal(first.devices.created, 1);
  assert.equal(first.groups.created, 1);

  const second = importProject(target, file);
  assert.equal(second.devices.created, 0);
  assert.equal(second.devices.skipped, 1);
  assert.equal(second.groups.created, 0);
  assert.equal(second.groups.skipped, 1);

  const count = target.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number };
  assert.equal(count.n, 1);
});

test('a macro built on a built-in command round-trips by key, not by numeric id', () => {
  const source = makeDb();
  const powerOnId = (source.prepare("SELECT id FROM commands WHERE key = 'power.on'").get() as { id: number }).id;
  const macroId = Number(
    source.prepare('INSERT INTO macros (name) VALUES (?)').run('Morning Startup').lastInsertRowid,
  );
  source
    .prepare('INSERT INTO macro_steps (macro_id, seq, command_id, delay_ms_after) VALUES (?, ?, ?, ?)')
    .run(macroId, 0, powerOnId, 500);

  const file = exportProject(source);
  assert.equal(file.macros.length, 1);
  assert.deepEqual(file.macros[0]?.steps[0]?.action, { kind: 'command', commandKey: 'power.on' });

  const target = makeDb(); // fresh db, built-ins seeded with (probably) different numeric ids
  const result = importProject(target, file);
  assert.equal(result.macros.created, 1);

  const targetPowerOnId = (target.prepare("SELECT id FROM commands WHERE key = 'power.on'").get() as { id: number }).id;
  const step = target.prepare('SELECT command_id, delay_ms_after FROM macro_steps WHERE macro_id = (SELECT id FROM macros WHERE name = ?)').get('Morning Startup') as {
    command_id: number;
    delay_ms_after: number;
  };
  assert.equal(step.command_id, targetPowerOnId);
  assert.equal(step.delay_ms_after, 500);
});

test('a macro step referencing an unknown command key is dropped with a warning, not fatal', () => {
  const target = makeDb();
  const file = exportProject(makeDb());
  file.macros.push({
    name: 'Broken Macro',
    description: null,
    colour: null,
    icon: null,
    sortOrder: 0,
    steps: [
      { action: { kind: 'command', commandKey: 'power.on' }, param: null, delayMsAfter: 200, target: null },
      { action: { kind: 'command', commandKey: 'no.such.command' }, param: null, delayMsAfter: 200, target: null },
    ],
  });

  const result = importProject(target, file);
  assert.equal(result.macros.created, 1);
  assert.ok(result.warnings.some((w) => w.includes('no.such.command')));

  const steps = target
    .prepare('SELECT * FROM macro_steps WHERE macro_id = (SELECT id FROM macros WHERE name = ?)')
    .all('Broken Macro');
  assert.equal(steps.length, 1);
});

test('a device referencing an unknown group name is still created, with a warning', () => {
  const target = makeDb();
  const file = exportProject(makeDb());
  file.devices.push({
    name: 'Orphan',
    host: '10.0.0.5',
    port: 1024,
    location: null,
    notes: null,
    pollIntervalSec: null,
    groupNames: ['Nonexistent Group'],
  });

  const result = importProject(target, file);
  assert.equal(result.devices.created, 1);
  assert.ok(result.warnings.some((w) => w.includes('Nonexistent Group')));
});

test('a macro-call step round-trips, even when the file declares the callee after the caller', () => {
  const target = makeDb();
  const file = exportProject(makeDb());
  file.macros.push(
    {
      name: 'Full Startup',
      description: null,
      colour: null,
      icon: null,
      sortOrder: 0,
      steps: [{ action: { kind: 'macro', macroName: 'Power On' }, param: null, delayMsAfter: 0, target: null }],
    },
    {
      name: 'Power On',
      description: null,
      colour: null,
      icon: null,
      sortOrder: 1,
      steps: [{ action: { kind: 'command', commandKey: 'power.on' }, param: null, delayMsAfter: 200, target: null }],
    },
  );

  const result = importProject(target, file);
  assert.equal(result.macros.created, 2);
  assert.deepEqual(result.warnings, []);

  const powerOnId = (target.prepare('SELECT id FROM macros WHERE name = ?').get('Power On') as { id: number }).id;
  const step = target
    .prepare('SELECT step_kind, child_macro_id FROM macro_steps WHERE macro_id = (SELECT id FROM macros WHERE name = ?)')
    .get('Full Startup') as { step_kind: string; child_macro_id: number };
  assert.equal(step.step_kind, 'macro');
  assert.equal(step.child_macro_id, powerOnId);
});

test('a macro-call step that would create a call loop within the imported file is dropped, not fatal', () => {
  const target = makeDb();
  const file = exportProject(makeDb());
  file.macros.push(
    {
      name: 'A',
      description: null,
      colour: null,
      icon: null,
      sortOrder: 0,
      steps: [{ action: { kind: 'macro', macroName: 'B' }, param: null, delayMsAfter: 0, target: null }],
    },
    {
      name: 'B',
      description: null,
      colour: null,
      icon: null,
      sortOrder: 1,
      steps: [{ action: { kind: 'macro', macroName: 'A' }, param: null, delayMsAfter: 0, target: null }],
    },
  );

  const result = importProject(target, file);
  assert.equal(result.macros.created, 1); // A: its call into B was the first edge, accepted
  assert.equal(result.macros.skipped, 1); // B: calling back into A would close the loop — dropped
  assert.ok(result.warnings.some((w) => w.includes('call loop')));

  const bSteps = target.prepare('SELECT COUNT(*) AS n FROM macro_steps WHERE macro_id = (SELECT id FROM macros WHERE name = ?)').get('B') as { n: number };
  assert.equal(bSteps.n, 0);
});

test('credentials are never part of the exported file', () => {
  const source = makeDb();
  source.prepare(
    "INSERT INTO settings (key, value) VALUES ('global_username', 'dispadmin'), ('global_password_enc', 'deadbeef')",
  ).run();
  const file = exportProject(source);
  assert.equal(JSON.stringify(file).includes('dispadmin'), false);
  assert.equal(JSON.stringify(file).includes('deadbeef'), false);
});
