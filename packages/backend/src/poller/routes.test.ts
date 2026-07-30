import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { startTestApp } from '../http/test-helpers.js';
import { Poller } from './poller.js';
import { pollerRouter } from './routes.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

async function setup() {
  const db = makeDb();
  const poller = new Poller(db, null);
  const app = await startTestApp((app) => app.use('/api/poller', pollerRouter(poller)));
  return { poller, app };
}

test('GET /api/poller/status reports running by default', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/poller/status`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { paused: false });
  } finally {
    await app.close();
  }
});

test('PUT /api/poller/status pauses and resumes the real Poller instance', async () => {
  const { poller, app } = await setup();
  try {
    const pauseRes = await fetch(`${app.baseUrl}/api/poller/status`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    });
    assert.deepEqual(await pauseRes.json(), { paused: true });
    assert.equal(poller.isPaused, true);

    const resumeRes = await fetch(`${app.baseUrl}/api/poller/status`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: false }),
    });
    assert.deepEqual(await resumeRes.json(), { paused: false });
    assert.equal(poller.isPaused, false);
  } finally {
    await app.close();
  }
});

test('PUT /api/poller/status rejects a non-boolean paused value', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/poller/status`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: 'yes' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});
