process.env.PPC_SECRET_KEY = 'aa'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { createDispatcher } from '../dispatch/dispatch.js';
import { MockProjector } from '../protocol/mock-server.js';
import { Scheduler } from './scheduler.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  seed(db);
  return db;
}

function insertTask(db: DatabaseSync, cron: string, enabled = 1): number {
  const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.on'").get()!.id);
  return Number(
    db
      .prepare(
        `INSERT INTO scheduled_tasks (name, cron, enabled, target_kind, action_kind, action_id)
         VALUES (?, ?, ?, 'all', 'command', ?)`,
      )
      .run('Test Task', cron, enabled, commandId).lastInsertRowid,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('Scheduler.start: registers a job per enabled task, skips disabled ones', () => {
  const db = makeDb();
  const enabledId = insertTask(db, '0 22 * * *', 1);
  insertTask(db, '0 23 * * *', 0);

  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const scheduler = new Scheduler(db, dispatch);
  scheduler.start();

  try {
    assert.deepEqual(scheduler.activeTaskIds, [enabledId]);
  } finally {
    scheduler.stop();
  }
});

test('Scheduler.stop: clears all registered jobs', () => {
  const db = makeDb();
  insertTask(db, '0 22 * * *');
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const scheduler = new Scheduler(db, dispatch);

  scheduler.start();
  assert.equal(scheduler.activeTaskIds.length, 1);
  scheduler.stop();
  assert.deepEqual(scheduler.activeTaskIds, []);
});

test('Scheduler.reload: picks up a task disabled after start() was called', () => {
  const db = makeDb();
  const taskId = insertTask(db, '0 22 * * *', 1);
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const scheduler = new Scheduler(db, dispatch);

  scheduler.start();
  assert.deepEqual(scheduler.activeTaskIds, [taskId]);

  db.prepare('UPDATE scheduled_tasks SET enabled = 0 WHERE id = ?').run(taskId);
  scheduler.reload();

  try {
    assert.deepEqual(scheduler.activeTaskIds, []);
  } finally {
    scheduler.stop();
  }
});

test('Scheduler: an enabled task with a seconds-precision cron actually fires and dispatches for real', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const port = await mock.listen();
  try {
    db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port);
    // Every second — proves real node-cron wiring end to end without waiting a full minute.
    const taskId = insertTask(db, '*/1 * * * * *');
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
    const scheduler = new Scheduler(db, dispatch);
    scheduler.start();

    try {
      await sleep(1500);
      const row = db.prepare('SELECT last_run_at, last_result FROM scheduled_tasks WHERE id = ?').get(taskId) as {
        last_run_at: string | null;
        last_result: string | null;
      };
      assert.ok(row.last_run_at, 'expected the task to have fired at least once');
      assert.equal(row.last_result, '1/1 succeeded');
    } finally {
      scheduler.stop();
    }
  } finally {
    await mock.close();
  }
});

test('Scheduler.stop: a stopped job does not keep firing', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port);
    const taskId = insertTask(db, '*/1 * * * * *');
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
    const scheduler = new Scheduler(db, dispatch);
    scheduler.start();
    await sleep(1200);
    scheduler.stop();

    const afterStop = db.prepare('SELECT last_run_at FROM scheduled_tasks WHERE id = ?').get(taskId) as {
      last_run_at: string;
    };
    await sleep(1200);
    const stillAfter = db.prepare('SELECT last_run_at FROM scheduled_tasks WHERE id = ?').get(taskId) as {
      last_run_at: string;
    };
    assert.equal(stillAfter.last_run_at, afterStop.last_run_at);
  } finally {
    await mock.close();
  }
});
