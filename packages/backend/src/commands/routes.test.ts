import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { startTestApp } from '../http/test-helpers.js';
import { commandsRouter } from './routes.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

async function setup(withSeed = false) {
  const db = makeDb();
  if (withSeed) seed(db);
  const app = await startTestApp((app) => app.use('/api/commands', commandsRouter(db)));
  return { db, app };
}

test('GET /api/commands lists the seeded built-in catalogue', async () => {
  const { app } = await setup(true);
  try {
    const res = await fetch(`${app.baseUrl}/api/commands`);
    const commands = (await res.json()) as { key: string; builtIn: boolean }[];
    assert.ok(commands.length > 0);
    assert.ok(commands.every((c) => c.builtIn));
    assert.ok(commands.some((c) => c.key === 'power.on'));
  } finally {
    await app.close();
  }
});

test('POST /api/commands creates a custom, non-built-in command', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'custom.thing', label: 'Custom Thing', body: 'OCU' }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { builtIn: boolean; key: string };
    assert.equal(body.builtIn, false);
    assert.equal(body.key, 'custom.thing');
  } finally {
    await app.close();
  }
});

test('POST /api/commands with paramKind "enum" requires non-empty paramOptions', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'bad.enum', label: 'Bad', body: 'X:{p}', paramKind: 'enum' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('POST /api/commands rejects a duplicate key', async () => {
  const { app } = await setup();
  try {
    await fetch(`${app.baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'dup.key', label: 'A', body: 'AAA' }),
    });
    const res = await fetch(`${app.baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'dup.key', label: 'B', body: 'BBB' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('DELETE /api/commands/:id refuses to delete a built-in command', async () => {
  const { db, app } = await setup(true);
  try {
    const row = db.prepare("SELECT id FROM commands WHERE key = 'power.on'").get() as { id: number };
    const res = await fetch(`${app.baseUrl}/api/commands/${row.id}`, { method: 'DELETE' });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test('DELETE /api/commands/:id succeeds for a custom command', async () => {
  const { app } = await setup();
  try {
    const created = (await (
      await fetch(`${app.baseUrl}/api/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'deletable', label: 'Deletable', body: 'X' }),
      })
    ).json()) as { id: number };

    const res = await fetch(`${app.baseUrl}/api/commands/${created.id}`, { method: 'DELETE' });
    assert.equal(res.status, 204);
  } finally {
    await app.close();
  }
});

test('PATCH /api/commands/:id can edit label/favourite even on a built-in command', async () => {
  const { db, app } = await setup(true);
  try {
    const row = db.prepare("SELECT id FROM commands WHERE key = 'power.on'").get() as { id: number };
    const res = await fetch(`${app.baseUrl}/api/commands/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ favourite: false, label: 'Power On (renamed)' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { favourite: boolean; label: string; builtIn: boolean };
    assert.equal(body.favourite, false);
    assert.equal(body.label, 'Power On (renamed)');
    assert.equal(body.builtIn, true);
  } finally {
    await app.close();
  }
});
