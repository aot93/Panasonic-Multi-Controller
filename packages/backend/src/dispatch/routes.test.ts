process.env.PPC_SECRET_KEY = '66'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { startTestApp } from '../http/test-helpers.js';
import { MockProjector } from '../protocol/mock-server.js';
import { createDispatcher } from './dispatch.js';
import { dispatchRouter } from './routes.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  seed(db);
  return db;
}

test('POST /api/dispatch dispatches a command and returns per-device results', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const port = await mock.listen();
  const deviceId = Number(
    db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port)
      .lastInsertRowid,
  );

  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const app = await startTestApp((app) => app.use('/api/dispatch', dispatchRouter(dispatch)));

  try {
    const res = await fetch(`${app.baseUrl}/api/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: { kind: 'device', ids: [deviceId] }, commandKey: 'power.on' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { dispatchId: string; results: { ok: boolean; deviceId: number }[] };
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0]?.ok, true);
    assert.ok(body.dispatchId);
  } finally {
    await app.close();
    await mock.close();
  }
});

test('POST /api/dispatch with an invalid target.kind is a 400 validation error', async () => {
  const db = makeDb();
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const app = await startTestApp((app) => app.use('/api/dispatch', dispatchRouter(dispatch)));

  try {
    const res = await fetch(`${app.baseUrl}/api/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: { kind: 'bogus' }, commandKey: 'power.on' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('POST /api/dispatch surfaces "no matching command" as 404', async () => {
  const db = makeDb();
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const app = await startTestApp((app) => app.use('/api/dispatch', dispatchRouter(dispatch)));

  try {
    const res = await fetch(`${app.baseUrl}/api/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: { kind: 'all' }, commandKey: 'no.such.command' }),
    });
    assert.equal(res.status, 404);
  } finally {
    await app.close();
  }
});
