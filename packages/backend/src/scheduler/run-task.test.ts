process.env.PPC_SECRET_KEY = '99'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { createDispatcher } from '../dispatch/dispatch.js';
import { MockProjector } from '../protocol/mock-server.js';
import { runScheduledTask, type ScheduledTaskRow } from './run-task.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  seed(db);
  return db;
}

function insertTask(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): number {
  const row = {
    name: 'Nightly Off',
    cron: '0 22 * * *',
    target_kind: 'all',
    target_id: null,
    action_kind: 'command',
    action_id: Number(db.prepare("SELECT id FROM commands WHERE key = 'power.off'").get()!.id),
    param: null,
    ...overrides,
  };
  return Number(
    db
      .prepare(
        `INSERT INTO scheduled_tasks (name, cron, target_kind, target_id, action_kind, action_id, param)
         VALUES (@name, @cron, @target_kind, @target_id, @action_kind, @action_id, @param)`,
      )
      .run(row).lastInsertRowid,
  );
}

function loadTaskRow(db: DatabaseSync, id: number): ScheduledTaskRow {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as unknown as ScheduledTaskRow;
}

test('runScheduledTask: dispatches to "all" and records a success summary', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'on' } });
  const port = await mock.listen();
  try {
    db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port);
    const taskId = insertTask(db);
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

    await runScheduledTask(db, dispatch, loadTaskRow(db, taskId));

    const row = db.prepare('SELECT last_run_at, last_result FROM scheduled_tasks WHERE id = ?').get(taskId) as {
      last_run_at: string | null;
      last_result: string | null;
    };
    assert.ok(row.last_run_at);
    assert.equal(row.last_result, '1/1 succeeded');
  } finally {
    await mock.close();
  }
});

test('runScheduledTask: partial failure is summarized with an example', async () => {
  const db = makeDb();
  const mockUp = new MockProjector({ protectMode: 'none' });
  const upPort = await mockUp.listen();
  const mockDown = new MockProjector({ protectMode: 'none' });
  const downPort = await mockDown.listen();
  await mockDown.close(); // this one is unreachable
  try {
    db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Up', '127.0.0.1', upPort);
    db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Down', '127.0.0.1', downPort);
    const taskId = insertTask(db);
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

    await runScheduledTask(db, dispatch, loadTaskRow(db, taskId));

    const row = db.prepare('SELECT last_result FROM scheduled_tasks WHERE id = ?').get(taskId) as {
      last_result: string;
    };
    assert.match(row.last_result, /^1\/2 succeeded/);
    assert.match(row.last_result, /Down:/);
  } finally {
    await mockUp.close();
  }
});

test('runScheduledTask: a target resolving to zero devices records the error rather than throwing', async () => {
  const db = makeDb();
  const taskId = insertTask(db); // no devices registered at all
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

  await runScheduledTask(db, dispatch, loadTaskRow(db, taskId));

  const row = db.prepare('SELECT last_result FROM scheduled_tasks WHERE id = ?').get(taskId) as {
    last_result: string;
  };
  assert.match(row.last_result, /^Error:/);
});

test('runScheduledTask: a macro action_kind referencing a nonexistent macro fails gracefully, not silently', async () => {
  const db = makeDb();
  const taskId = insertTask(db, { action_kind: 'macro', action_id: 999 });
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

  await runScheduledTask(db, dispatch, loadTaskRow(db, taskId));

  const row = db.prepare('SELECT last_result FROM scheduled_tasks WHERE id = ?').get(taskId) as {
    last_result: string;
  };
  assert.match(row.last_result, /^Error:/);
});

test('runScheduledTask: a real macro action_kind actually runs the macro\'s steps', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const port = await mock.listen();
  try {
    db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port);
    const onCommandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.on'").get()!.id);
    const macroId = Number(db.prepare('INSERT INTO macros (name) VALUES (?)').run('Turn On').lastInsertRowid);
    db.prepare('INSERT INTO macro_steps (macro_id, seq, command_id, delay_ms_after) VALUES (?, 0, ?, 0)').run(
      macroId,
      onCommandId,
    );
    const taskId = insertTask(db, { action_kind: 'macro', action_id: macroId });
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });

    await runScheduledTask(db, dispatch, loadTaskRow(db, taskId));

    const row = db.prepare('SELECT last_result FROM scheduled_tasks WHERE id = ?').get(taskId) as {
      last_result: string;
    };
    assert.equal(row.last_result, 'Macro: 1/1 steps completed');
    assert.equal(mock.state.power, 'on');
  } finally {
    await mock.close();
  }
});
