import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { startTestApp } from '../http/test-helpers.js';
import { groupsRouter } from './routes.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

async function setup() {
  const db = makeDb();
  const app = await startTestApp((app) => app.use('/api/groups', groupsRouter(db)));
  return { db, app };
}

test('POST /api/groups creates a group with deviceCount 0', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ground Floor' }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { name: string; deviceCount: number };
    assert.equal(body.name, 'Ground Floor');
    assert.equal(body.deviceCount, 0);
  } finally {
    await app.close();
  }
});

test('GET /api/groups reflects real device membership counts', async () => {
  const { db, app } = await setup();
  try {
    const groupId = Number(db.prepare('INSERT INTO groups (name) VALUES (?)').run('Building A').lastInsertRowid);
    const deviceId = Number(
      db.prepare('INSERT INTO devices (name, host) VALUES (?, ?)').run('D1', '192.168.0.1').lastInsertRowid,
    );
    db.prepare('INSERT INTO device_groups (device_id, group_id) VALUES (?, ?)').run(deviceId, groupId);

    const res = await fetch(`${app.baseUrl}/api/groups`);
    const groups = (await res.json()) as { id: number; deviceCount: number }[];
    assert.equal(groups.find((g) => g.id === groupId)?.deviceCount, 1);
  } finally {
    await app.close();
  }
});

test('POST /api/groups rejects a duplicate name', async () => {
  const { app } = await setup();
  try {
    await fetch(`${app.baseUrl}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Dup' }),
    });
    const res = await fetch(`${app.baseUrl}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Dup' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('DELETE /api/groups/:id cascades and removes device_groups links', async () => {
  const { db, app } = await setup();
  try {
    const groupId = Number(db.prepare('INSERT INTO groups (name) VALUES (?)').run('Temp').lastInsertRowid);
    const deviceId = Number(
      db.prepare('INSERT INTO devices (name, host) VALUES (?, ?)').run('D1', '192.168.0.2').lastInsertRowid,
    );
    db.prepare('INSERT INTO device_groups (device_id, group_id) VALUES (?, ?)').run(deviceId, groupId);

    const res = await fetch(`${app.baseUrl}/api/groups/${groupId}`, { method: 'DELETE' });
    assert.equal(res.status, 204);

    const remaining = db.prepare('SELECT COUNT(*) AS n FROM device_groups WHERE group_id = ?').get(groupId) as {
      n: number;
    };
    assert.equal(remaining.n, 0);
  } finally {
    await app.close();
  }
});

test('PATCH /api/groups/:id updates sortOrder and description', async () => {
  const { app } = await setup();
  try {
    const created = (await (
      await fetch(`${app.baseUrl}/api/groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Reorder Me' }),
      })
    ).json()) as { id: number };

    const res = await fetch(`${app.baseUrl}/api/groups/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sortOrder: 5, description: 'moved' }),
    });
    const body = (await res.json()) as { sortOrder: number; description: string };
    assert.equal(body.sortOrder, 5);
    assert.equal(body.description, 'moved');
  } finally {
    await app.close();
  }
});
