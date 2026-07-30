process.env.PPC_SECRET_KEY = 'bb'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { createDispatcher } from '../dispatch/dispatch.js';
import { startTestApp } from '../http/test-helpers.js';
import { MockProjector } from '../protocol/mock-server.js';
import { schedulesRouter } from './routes.js';
import { Scheduler } from './scheduler.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  seed(db);
  return db;
}

async function setup() {
  const db = makeDb();
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const scheduler = new Scheduler(db, dispatch);
  const app = await startTestApp((app) => app.use('/api/schedules', schedulesRouter(db, scheduler, dispatch)));
  return { db, app, scheduler, dispatch };
}

test('POST /api/schedules creates a task and starts it in the running scheduler', async () => {
  const { db, app, scheduler } = await setup();
  try {
    const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.off'").get()!.id);
    scheduler.start();

    const res = await fetch(`${app.baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nightly Off', cron: '0 22 * * *', targetKind: 'all', actionKind: 'command', actionId: commandId }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { id: number; name: string; enabled: boolean };
    assert.equal(body.name, 'Nightly Off');
    assert.equal(body.enabled, true);
    assert.deepEqual(scheduler.activeTaskIds, [body.id]);
  } finally {
    scheduler.stop();
    await app.close();
  }
});

test('POST /api/schedules rejects an invalid cron expression', async () => {
  const { db, app, scheduler } = await setup();
  try {
    const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.off'").get()!.id);
    const res = await fetch(`${app.baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad', cron: 'not a cron', targetKind: 'all', actionKind: 'command', actionId: commandId }),
    });
    assert.equal(res.status, 400);
  } finally {
    scheduler.stop();
    await app.close();
  }
});

test('POST /api/schedules rejects "device" target with no targetId', async () => {
  const { db, app, scheduler } = await setup();
  try {
    const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.off'").get()!.id);
    const res = await fetch(`${app.baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad Target', cron: '0 22 * * *', targetKind: 'device', actionKind: 'command', actionId: commandId }),
    });
    assert.equal(res.status, 400);
  } finally {
    scheduler.stop();
    await app.close();
  }
});

test('PATCH /api/schedules/:id disabling a task removes it from the running scheduler', async () => {
  const { db, app, scheduler } = await setup();
  try {
    const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.off'").get()!.id);
    scheduler.start();

    const created = (await (
      await fetch(`${app.baseUrl}/api/schedules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Toggle Me', cron: '0 22 * * *', targetKind: 'all', actionKind: 'command', actionId: commandId }),
      })
    ).json()) as { id: number };
    assert.deepEqual(scheduler.activeTaskIds, [created.id]);

    const patched = await fetch(`${app.baseUrl}/api/schedules/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(patched.status, 200);
    assert.deepEqual(scheduler.activeTaskIds, []);
  } finally {
    scheduler.stop();
    await app.close();
  }
});

test('PATCH /api/schedules/:id rejects an update that would violate the target invariant', async () => {
  const { db, app, scheduler } = await setup();
  try {
    const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.off'").get()!.id);
    const created = (await (
      await fetch(`${app.baseUrl}/api/schedules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'All Target', cron: '0 22 * * *', targetKind: 'all', actionKind: 'command', actionId: commandId }),
      })
    ).json()) as { id: number };

    // Setting targetId on an "all" task violates the DB CHECK constraint —
    // must come back as a clean 400, not a raw SQLite error.
    const res = await fetch(`${app.baseUrl}/api/schedules/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: 5 }),
    });
    assert.equal(res.status, 400);
  } finally {
    scheduler.stop();
    await app.close();
  }
});

test('DELETE /api/schedules/:id removes it and stops it firing', async () => {
  const { db, app, scheduler } = await setup();
  try {
    const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.off'").get()!.id);
    scheduler.start();
    const created = (await (
      await fetch(`${app.baseUrl}/api/schedules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Delete Me', cron: '0 22 * * *', targetKind: 'all', actionKind: 'command', actionId: commandId }),
      })
    ).json()) as { id: number };

    const res = await fetch(`${app.baseUrl}/api/schedules/${created.id}`, { method: 'DELETE' });
    assert.equal(res.status, 204);
    assert.deepEqual(scheduler.activeTaskIds, []);
  } finally {
    scheduler.stop();
    await app.close();
  }
});

test('POST /api/schedules/:id/run fires the task immediately without waiting for its cron time', async () => {
  const { db, app, scheduler } = await setup();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const port = await mock.listen();
  try {
    db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port);
    const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.on'").get()!.id);
    const created = (await (
      await fetch(`${app.baseUrl}/api/schedules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Far in the future — proves /run doesn't wait for the schedule.
        body: JSON.stringify({ name: 'Manual Run', cron: '0 0 1 1 *', targetKind: 'all', actionKind: 'command', actionId: commandId }),
      })
    ).json()) as { id: number };

    const res = await fetch(`${app.baseUrl}/api/schedules/${created.id}/run`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { lastResult: string };
    assert.equal(body.lastResult, '1/1 succeeded');
  } finally {
    scheduler.stop();
    await app.close();
    await mock.close();
  }
});

test('GET /api/schedules/:id returns 404 for an unknown id', async () => {
  const { app, scheduler } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/schedules/999`);
    assert.equal(res.status, 404);
  } finally {
    scheduler.stop();
    await app.close();
  }
});
