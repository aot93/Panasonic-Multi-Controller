import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { DeviceEvent } from '@ppc/shared';
import { runMigrations } from '../db/migrate.js';
import { startTestApp } from '../http/test-helpers.js';
import { eventsRouter } from './routes.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

function insertEvent(
  db: DatabaseSync,
  overrides: Partial<{ deviceId: number | null; severity: string; code: string; message: string; createdAt: string }> = {},
): number {
  const info = db
    .prepare('INSERT INTO events (device_id, severity, code, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(
      overrides.deviceId ?? null,
      overrides.severity ?? 'error',
      overrides.code ?? 'comms.lost',
      overrides.message ?? 'Connection refused',
      overrides.createdAt ?? new Date().toISOString(),
    );
  return Number(info.lastInsertRowid);
}

async function setup() {
  const db = makeDb();
  const app = await startTestApp((app) => app.use('/api/events', eventsRouter(db)));
  return { db, app };
}

test('GET /api/events returns everything, newest first', async () => {
  const { db, app } = await setup();
  try {
    insertEvent(db, { createdAt: '2026-01-01T00:00:00.000Z', message: 'first' });
    insertEvent(db, { createdAt: '2026-01-02T00:00:00.000Z', message: 'second' });

    const res = await fetch(`${app.baseUrl}/api/events`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as DeviceEvent[];
    assert.equal(body.length, 2);
    assert.equal(body[0]?.message, 'second');
    assert.equal(body[1]?.message, 'first');
  } finally {
    await app.close();
  }
});

test('GET /api/events?deviceId= filters to one device', async () => {
  const { db, app } = await setup();
  try {
    const deviceId = Number(db.prepare('INSERT INTO devices (name, host) VALUES (?, ?)').run('Foyer', '192.168.0.101').lastInsertRowid);
    insertEvent(db, { deviceId, message: 'device event' });
    insertEvent(db, { deviceId: null, message: 'server event' });

    const res = await fetch(`${app.baseUrl}/api/events?deviceId=${deviceId}`);
    const body = (await res.json()) as DeviceEvent[];
    assert.equal(body.length, 1);
    assert.equal(body[0]?.message, 'device event');
  } finally {
    await app.close();
  }
});

test('GET /api/events?severity= filters by severity', async () => {
  const { db, app } = await setup();
  try {
    insertEvent(db, { severity: 'critical', message: 'crit' });
    insertEvent(db, { severity: 'info', message: 'info msg' });

    const res = await fetch(`${app.baseUrl}/api/events?severity=critical`);
    const body = (await res.json()) as DeviceEvent[];
    assert.equal(body.length, 1);
    assert.equal(body[0]?.severity, 'critical');
  } finally {
    await app.close();
  }
});

test('GET /api/events?limit= caps the result count', async () => {
  const { db, app } = await setup();
  try {
    for (let i = 0; i < 5; i++) insertEvent(db, { message: `event ${i}` });

    const res = await fetch(`${app.baseUrl}/api/events?limit=2`);
    const body = (await res.json()) as DeviceEvent[];
    assert.equal(body.length, 2);
  } finally {
    await app.close();
  }
});
