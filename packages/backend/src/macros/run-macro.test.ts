process.env.PPC_SECRET_KEY = 'cc'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { createDispatcher } from '../dispatch/dispatch.js';
import { MockProjector } from '../protocol/mock-server.js';
import { runMacro, summarizeMacroRun } from './run-macro.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  seed(db);
  return db;
}

function commandId(db: DatabaseSync, key: string): number {
  return Number(db.prepare('SELECT id FROM commands WHERE key = ?').get(key)!.id);
}

function insertMacro(db: DatabaseSync, name = 'Test Macro'): number {
  return Number(db.prepare('INSERT INTO macros (name) VALUES (?)').run(name).lastInsertRowid);
}

function insertStep(
  db: DatabaseSync,
  macroId: number,
  seq: number,
  cmdId: number,
  overrides: Partial<{ param: string | null; delayMsAfter: number; targetKind: string | null; targetId: number | null }> = {},
): void {
  db.prepare(
    `INSERT INTO macro_steps (macro_id, seq, command_id, param, delay_ms_after, target_kind, target_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    macroId,
    seq,
    cmdId,
    overrides.param ?? null,
    overrides.delayMsAfter ?? 0,
    overrides.targetKind ?? null,
    overrides.targetId ?? null,
  );
}

test('runMacro: a single-step macro runs against the invocation target', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const port = await mock.listen();
  try {
    const deviceId = Number(
      db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port)
        .lastInsertRowid,
    );
    const macroId = insertMacro(db);
    insertStep(db, macroId, 0, commandId(db, 'power.on'));
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

    const result = await runMacro(db, dispatch, macroId, { kind: 'device', ids: [deviceId] }, 'ui');
    assert.equal(result.ok, true);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0]?.ok, true);
    assert.equal(mock.state.power, 'on');
  } finally {
    await mock.close();
  }
});

test('runMacro: multiple steps run in order, each affecting state before the next runs', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off', aspect: 0 } });
  const port = await mock.listen();
  try {
    const deviceId = Number(
      db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port)
        .lastInsertRowid,
    );
    const macroId = insertMacro(db);
    insertStep(db, macroId, 0, commandId(db, 'power.on'));
    insertStep(db, macroId, 1, commandId(db, 'aspect.set'), { param: '6' });
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

    const result = await runMacro(db, dispatch, macroId, { kind: 'device', ids: [deviceId] }, 'ui');
    assert.equal(result.ok, true);
    assert.equal(result.steps.length, 2);
    assert.equal(mock.state.power, 'on');
    assert.equal(mock.state.aspect, 6);
  } finally {
    await mock.close();
  }
});

test('runMacro: a per-step target override wins over the invocation target', async () => {
  const db = makeDb();
  const mockA = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const mockB = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const portA = await mockA.listen();
  const portB = await mockB.listen();
  try {
    const deviceA = Number(
      db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('A', '127.0.0.1', portA)
        .lastInsertRowid,
    );
    const deviceB = Number(
      db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('B', '127.0.0.1', portB)
        .lastInsertRowid,
    );
    const macroId = insertMacro(db);
    // Step targets device B specifically, even though we invoke against device A.
    insertStep(db, macroId, 0, commandId(db, 'power.on'), { targetKind: 'device', targetId: deviceB });
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

    await runMacro(db, dispatch, macroId, { kind: 'device', ids: [deviceA] }, 'ui');
    assert.equal(mockA.state.power, 'off');
    assert.equal(mockB.state.power, 'on');
  } finally {
    await mockA.close();
    await mockB.close();
  }
});

test('runMacro: a step with no override and no invocation target stops the run', async () => {
  const db = makeDb();
  const macroId = insertMacro(db);
  insertStep(db, macroId, 0, commandId(db, 'power.on'));
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

  const result = await runMacro(db, dispatch, macroId, null, 'ui');
  assert.equal(result.ok, false);
  assert.equal(result.steps[0]?.ok, false);
  assert.match(result.steps[0]?.error ?? '', /No target resolved/);
});

test('runMacro: a step whose target resolves to zero devices stops the sequence, later steps do not run', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const port = await mock.listen();
  try {
    const deviceId = Number(
      db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port)
        .lastInsertRowid,
    );
    const macroId = insertMacro(db);
    // This step's override points at a device id that doesn't exist — dispatch()
    // throws BadRequestError ("zero enabled devices"), a structural failure.
    insertStep(db, macroId, 0, commandId(db, 'power.off'), { targetKind: 'device', targetId: 999999 });
    insertStep(db, macroId, 1, commandId(db, 'power.on'));
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

    const result = await runMacro(db, dispatch, macroId, { kind: 'device', ids: [deviceId] }, 'ui');
    assert.equal(result.ok, false);
    assert.equal(result.steps.length, 1); // stopped after the first (failing) step
    assert.match(result.steps[0]?.error ?? '', /zero enabled devices/);
    assert.equal(mock.state.power, 'off'); // second step never ran
  } finally {
    await mock.close();
  }
});

test('runMacro: a partial per-device failure within a step does not halt later steps', async () => {
  const db = makeDb();
  const mockUp = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const mockDown = new MockProjector({ protectMode: 'none' });
  const upPort = await mockUp.listen();
  const downPort = await mockDown.listen();
  await mockDown.close();
  try {
    const groupId = Number(db.prepare('INSERT INTO groups (name) VALUES (?)').run('Both').lastInsertRowid);
    const upId = Number(
      db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Up', '127.0.0.1', upPort)
        .lastInsertRowid,
    );
    const downId = Number(
      db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Down', '127.0.0.1', downPort)
        .lastInsertRowid,
    );
    db.prepare('INSERT INTO device_groups (device_id, group_id) VALUES (?, ?), (?, ?)').run(
      upId,
      groupId,
      downId,
      groupId,
    );
    const macroId = insertMacro(db);
    insertStep(db, macroId, 0, commandId(db, 'power.on')); // one device in the group is down
    insertStep(db, macroId, 1, commandId(db, 'aspect.set'), { param: '6' });
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

    const result = await runMacro(db, dispatch, macroId, { kind: 'group', ids: [groupId] }, 'ui');
    assert.equal(result.ok, false); // step 0 had a partial failure
    assert.equal(result.steps.length, 2); // but step 1 still ran
    assert.equal(mockUp.state.aspect, 6);
  } finally {
    await mockUp.close();
  }
});

test('runMacro: a macro with no steps (or a nonexistent id) throws', async () => {
  const db = makeDb();
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  await assert.rejects(() => runMacro(db, dispatch, 999, { kind: 'all' }, 'ui'));
});

test('runMacro: a macro-call step runs the nested macro, target falls through from the outer invocation', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off', aspect: 0 } });
  const port = await mock.listen();
  try {
    const deviceId = Number(
      db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port)
        .lastInsertRowid,
    );
    const innerId = insertMacro(db, 'Power On');
    insertStep(db, innerId, 0, commandId(db, 'power.on'));
    const outerId = insertMacro(db, 'Full Startup');
    db.prepare(
      `INSERT INTO macro_steps (macro_id, seq, step_kind, child_macro_id, delay_ms_after) VALUES (?, 0, 'macro', ?, 0)`,
    ).run(outerId, innerId);
    insertStep(db, outerId, 1, commandId(db, 'aspect.set'), { param: '6' });
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

    const result = await runMacro(db, dispatch, outerId, { kind: 'device', ids: [deviceId] }, 'ui');
    assert.equal(result.ok, true);
    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[0]?.kind, 'macro');
    assert.equal(result.steps[0]?.nested?.macroId, innerId);
    assert.equal(mock.state.power, 'on');
    assert.equal(mock.state.aspect, 6);
  } finally {
    await mock.close();
  }
});

test('runMacro: a step calling a macro already on the call chain is refused instead of recursing forever', async () => {
  const db = makeDb();
  const aId = insertMacro(db, 'A');
  const bId = insertMacro(db, 'B');
  // Direct SQL bypasses the API's write-time loop gate (macros/routes.ts),
  // simulating rows that ended up cyclic some other way — run-macro.ts's
  // call-chain guard is the last-resort backstop for exactly this.
  db.prepare(`INSERT INTO macro_steps (macro_id, seq, step_kind, child_macro_id, delay_ms_after) VALUES (?, 0, 'macro', ?, 0)`).run(aId, bId);
  db.prepare(`INSERT INTO macro_steps (macro_id, seq, step_kind, child_macro_id, delay_ms_after) VALUES (?, 0, 'macro', ?, 0)`).run(bId, aId);
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

  const result = await runMacro(db, dispatch, aId, { kind: 'all' }, 'ui');
  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 1); // A has one step: call B
  assert.equal(result.steps[0]?.ok, false);
  const nested = result.steps[0]?.nested; // B's own run: its one step (calling back into A) was refused
  assert.equal(nested?.ok, false);
  assert.equal(nested?.steps.length, 1);
  assert.match(nested?.steps[0]?.error ?? '', /loop/);
});

test('summarizeMacroRun: full success', () => {
  const summary = summarizeMacroRun({
    macroId: 1,
    ok: true,
    steps: [
      { seq: 0, kind: 'command', commandId: 1, childMacroId: null, ok: true, error: null, results: [], nested: null },
      { seq: 1, kind: 'command', commandId: 2, childMacroId: null, ok: true, error: null, results: [], nested: null },
    ],
  });
  assert.equal(summary, 'Macro: 2/2 steps completed');
});

test('summarizeMacroRun: reports the first failing step', () => {
  const summary = summarizeMacroRun({
    macroId: 1,
    ok: false,
    steps: [
      { seq: 0, kind: 'command', commandId: 1, childMacroId: null, ok: true, error: null, results: [], nested: null },
      { seq: 1, kind: 'command', commandId: 2, childMacroId: null, ok: false, error: 'connection refused', results: null, nested: null },
    ],
  });
  assert.equal(summary, 'Macro: 1/2 steps completed (step 1 failed: connection refused)');
});
