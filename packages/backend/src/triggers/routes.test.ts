process.env.PPC_SECRET_KEY = '88'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { createDispatcher } from '../dispatch/dispatch.js';
import { startTestApp } from '../http/test-helpers.js';
import { ExternalTriggerServer } from './external-trigger-server.js';
import { triggersRouter } from './routes.js';

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
  const triggerServer = new ExternalTriggerServer(db, dispatch);
  const app = await startTestApp((app) => app.use('/api/triggers', triggersRouter(db, triggerServer)));
  return { db, app, triggerServer };
}

test('GET /api/triggers/settings reflects the disabled-by-default posture', async () => {
  const { app, triggerServer } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/triggers/settings`);
    const body = (await res.json()) as { enabled: boolean; running: boolean };
    assert.equal(body.enabled, false);
    assert.equal(body.running, false);
  } finally {
    await app.close();
    await triggerServer.stop();
  }
});

test('PUT /api/triggers/settings enables the listener and it actually starts', async () => {
  const { app, triggerServer } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/triggers/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, tcpPort: 19200, udpPort: 19201 }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { running: boolean };
    assert.equal(body.running, true);
    assert.equal(triggerServer.isRunning, true);
  } finally {
    await triggerServer.stop();
    await app.close();
  }
});

test('POST /api/triggers creates a trigger; "all" target must not set targetId', async () => {
  const { db, app, triggerServer } = await setup();
  try {
    const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.off'").get()!.id);
    const badRes = await fetch(`${app.baseUrl}/api/triggers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        triggerKey: 'NIGHTLY_OFF',
        targetKind: 'all',
        targetId: 5,
        actionKind: 'command',
        actionId: commandId,
      }),
    });
    assert.equal(badRes.status, 400);

    const goodRes = await fetch(`${app.baseUrl}/api/triggers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        triggerKey: 'NIGHTLY_OFF',
        targetKind: 'all',
        actionKind: 'command',
        actionId: commandId,
      }),
    });
    assert.equal(goodRes.status, 201);
  } finally {
    await app.close();
    await triggerServer.stop();
  }
});

test('POST /api/triggers rejects a duplicate triggerKey', async () => {
  const { db, app, triggerServer } = await setup();
  try {
    const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.off'").get()!.id);
    const payload = JSON.stringify({
      triggerKey: 'DUP_KEY',
      targetKind: 'all',
      actionKind: 'command',
      actionId: commandId,
    });
    await fetch(`${app.baseUrl}/api/triggers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    const res = await fetch(`${app.baseUrl}/api/triggers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
    await triggerServer.stop();
  }
});

test('PATCH /api/triggers/:id can disable a trigger, DELETE removes it', async () => {
  const { db, app, triggerServer } = await setup();
  try {
    const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.off'").get()!.id);
    const created = (await (
      await fetch(`${app.baseUrl}/api/triggers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ triggerKey: 'TOGGLE_ME', targetKind: 'all', actionKind: 'command', actionId: commandId }),
      })
    ).json()) as { id: number };

    const patched = await fetch(`${app.baseUrl}/api/triggers/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    const patchedBody = (await patched.json()) as { enabled: boolean };
    assert.equal(patchedBody.enabled, false);

    const deleted = await fetch(`${app.baseUrl}/api/triggers/${created.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
  } finally {
    await app.close();
    await triggerServer.stop();
  }
});
