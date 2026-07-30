process.env.PPC_SECRET_KEY = 'dd'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { createDispatcher } from '../dispatch/dispatch.js';
import { startTestApp } from '../http/test-helpers.js';
import { MockProjector } from '../protocol/mock-server.js';
import { macrosRouter } from './routes.js';

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
  const app = await startTestApp((app) => app.use('/api/macros', macrosRouter(db, dispatch)));
  return { db, app, dispatch };
}

function commandId(db: DatabaseSync, key: string): number {
  return Number(db.prepare('SELECT id FROM commands WHERE key = ?').get(key)!.id);
}

test('POST /api/macros creates a macro with ordered steps', async () => {
  const { db, app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/macros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Shutdown Sequence',
        steps: [
          { commandId: commandId(db, 'shutter.close') },
          { commandId: commandId(db, 'power.off'), delayMsAfter: 500 },
        ],
      }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { name: string; steps: { seq: number; commandId: number }[] };
    assert.equal(body.name, 'Shutdown Sequence');
    assert.equal(body.steps.length, 2);
    assert.equal(body.steps[0]?.seq, 0);
    assert.equal(body.steps[1]?.seq, 1);
  } finally {
    await app.close();
  }
});

test('POST /api/macros rejects a macro with zero steps', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/macros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Empty', steps: [] }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('POST /api/macros rejects a step referencing a nonexistent commandId', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/macros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad Step', steps: [{ commandId: 999999 }] }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('POST /api/macros rejects a step target override that violates the all/targetId invariant', async () => {
  const { db, app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/macros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Override',
        steps: [{ commandId: commandId(db, 'power.on'), targetKind: 'all', targetId: 5 }],
      }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('PATCH /api/macros/:id can replace the entire step sequence', async () => {
  const { db, app } = await setup();
  try {
    const created = (await (
      await fetch(`${app.baseUrl}/api/macros`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Editable', steps: [{ commandId: commandId(db, 'power.on') }] }),
      })
    ).json()) as { id: number };

    const patched = await fetch(`${app.baseUrl}/api/macros/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        steps: [{ commandId: commandId(db, 'power.off') }, { commandId: commandId(db, 'shutter.close') }],
      }),
    });
    assert.equal(patched.status, 200);
    const body = (await patched.json()) as { steps: { commandId: number }[] };
    assert.equal(body.steps.length, 2);
  } finally {
    await app.close();
  }
});

test('DELETE /api/macros/:id cascades and removes its steps', async () => {
  const { db, app } = await setup();
  try {
    const created = (await (
      await fetch(`${app.baseUrl}/api/macros`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Deletable', steps: [{ commandId: commandId(db, 'power.on') }] }),
      })
    ).json()) as { id: number };

    const res = await fetch(`${app.baseUrl}/api/macros/${created.id}`, { method: 'DELETE' });
    assert.equal(res.status, 204);

    const remaining = db.prepare('SELECT COUNT(*) AS n FROM macro_steps WHERE macro_id = ?').get(created.id) as {
      n: number;
    };
    assert.equal(remaining.n, 0);
  } finally {
    await app.close();
  }
});

test('POST /api/macros/:id/run executes the macro against a supplied target', async () => {
  const { db, app } = await setup();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const port = await mock.listen();
  try {
    const deviceId = Number(
      db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port)
        .lastInsertRowid,
    );
    const created = (await (
      await fetch(`${app.baseUrl}/api/macros`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Run Me', steps: [{ commandId: commandId(db, 'power.on') }] }),
      })
    ).json()) as { id: number };

    const res = await fetch(`${app.baseUrl}/api/macros/${created.id}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: { kind: 'device', ids: [deviceId] } }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
    assert.equal(mock.state.power, 'on');
  } finally {
    await app.close();
    await mock.close();
  }
});

test('GET /api/macros/:id returns 404 for an unknown id', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/macros/999`);
    assert.equal(res.status, 404);
  } finally {
    await app.close();
  }
});
