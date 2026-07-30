process.env.PPC_SECRET_KEY = 'ee'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { startTestApp } from '../http/test-helpers.js';
import { settingsRouter } from './routes.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

async function setup() {
  const db = makeDb();
  const app = await startTestApp((app) => app.use('/api/settings', settingsRouter(db)));
  return { db, app };
}

test('GET /api/settings/credentials reports not configured by default', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/settings/credentials`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { configured: false, username: null });
  } finally {
    await app.close();
  }
});

test('PUT /api/settings/credentials sets it, GET reports the username but never the password', async () => {
  const { app } = await setup();
  try {
    const putRes = await fetch(`${app.baseUrl}/api/settings/credentials`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin1', password: 'panasonic' }),
    });
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.deepEqual(putBody, { configured: true, username: 'admin1' });
    assert.equal('password' in putBody, false);

    const getRes = await fetch(`${app.baseUrl}/api/settings/credentials`);
    assert.deepEqual(await getRes.json(), { configured: true, username: 'admin1' });
  } finally {
    await app.close();
  }
});

test('PUT /api/settings/credentials rejects a missing password', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/settings/credentials`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin1' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('DELETE /api/settings/credentials clears it', async () => {
  const { app } = await setup();
  try {
    await fetch(`${app.baseUrl}/api/settings/credentials`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin1', password: 'panasonic' }),
    });
    const delRes = await fetch(`${app.baseUrl}/api/settings/credentials`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);
    assert.deepEqual(await delRes.json(), { configured: false, username: null });
  } finally {
    await app.close();
  }
});

test('GET /api/settings/name-verification defaults to 0.8 (migration 005 seeds it)', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/settings/name-verification`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { similarityThreshold: 0.8 });
  } finally {
    await app.close();
  }
});

test('PUT /api/settings/name-verification updates the threshold used by GET', async () => {
  const { app } = await setup();
  try {
    const putRes = await fetch(`${app.baseUrl}/api/settings/name-verification`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ similarityThreshold: 0.6 }),
    });
    assert.equal(putRes.status, 200);
    assert.deepEqual(await putRes.json(), { similarityThreshold: 0.6 });

    const getRes = await fetch(`${app.baseUrl}/api/settings/name-verification`);
    assert.deepEqual(await getRes.json(), { similarityThreshold: 0.6 });
  } finally {
    await app.close();
  }
});

test('PUT /api/settings/name-verification rejects a threshold outside 0-1', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/settings/name-verification`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ similarityThreshold: 1.5 }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('a device with no override falls back to the global default set via this route', async () => {
  const { db, app } = await setup();
  try {
    await fetch(`${app.baseUrl}/api/settings/credentials`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin1', password: 'panasonic' }),
    });

    const { getDeviceCredentials } = await import('../credentials/store.js');
    const deviceId = Number(
      db.prepare('INSERT INTO devices (name, host) VALUES (?, ?)').run('Foyer', '192.168.0.180').lastInsertRowid,
    );
    assert.deepEqual(getDeviceCredentials(db, deviceId), { username: 'admin1', password: 'panasonic' });
  } finally {
    await app.close();
  }
});
