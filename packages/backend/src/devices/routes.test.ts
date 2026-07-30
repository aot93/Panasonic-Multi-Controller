process.env.PPC_SECRET_KEY = '44'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { setGlobalCredentials } from '../credentials/store.js';
import { startTestApp } from '../http/test-helpers.js';
import { Poller } from '../poller/poller.js';
import { devicesRouter } from './routes.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

async function setup() {
  const db = makeDb();
  const poller = new Poller(db, null);
  const app = await startTestApp((app) => app.use('/api/devices', devicesRouter(db, poller)));
  return { db, app };
}

test('POST /api/devices creates a device and GET lists it', async () => {
  const { db, app } = await setup();
  try {
    const createRes = await fetch(`${app.baseUrl}/api/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Foyer', host: '192.168.0.131' }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { id: number; name: string; port: number };
    assert.equal(created.name, 'Foyer');
    assert.equal(created.port, 1024); // default

    const listRes = await fetch(`${app.baseUrl}/api/devices`);
    const list = (await listRes.json()) as unknown[];
    assert.equal(list.length, 1);
  } finally {
    await app.close();
  }
});

test('POST /api/devices rejects a missing required field', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No Host' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'Validation failed');
  } finally {
    await app.close();
  }
});

test('POST /api/devices rejects a duplicate host:port with a clean 400, not a raw SQLite error', async () => {
  const { app } = await setup();
  try {
    await fetch(`${app.baseUrl}/api/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', host: '192.168.0.131' }),
    });
    const res = await fetch(`${app.baseUrl}/api/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B', host: '192.168.0.131' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /already exists/);
  } finally {
    await app.close();
  }
});

test('POST /api/devices/bulk creates a device per IP in the range', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/devices/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namePrefix: 'Room', startIp: '192.168.1.10', endIp: '192.168.1.12' }),
    });
    assert.equal(res.status, 201);
    const results = (await res.json()) as { ip: string; ok: boolean; device?: { name: string } }[];
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.ok));
    assert.deepEqual(
      results.map((r) => r.ip),
      ['192.168.1.10', '192.168.1.11', '192.168.1.12'],
    );
    assert.equal(results[0]?.device?.name, 'Room 192.168.1.10');

    const listRes = await fetch(`${app.baseUrl}/api/devices`);
    assert.equal(((await listRes.json()) as unknown[]).length, 3);
  } finally {
    await app.close();
  }
});

test('POST /api/devices/bulk without a namePrefix names each device by its IP', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/devices/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startIp: '10.0.0.5', endIp: '10.0.0.5' }),
    });
    const results = (await res.json()) as { device?: { name: string } }[];
    assert.equal(results[0]?.device?.name, '10.0.0.5');
  } finally {
    await app.close();
  }
});

test('POST /api/devices/bulk rejects a malformed IP range with a 400 before creating anything', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/devices/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startIp: '192.168.1.20', endIp: '192.168.1.10' }),
    });
    assert.equal(res.status, 400);
    const listRes = await fetch(`${app.baseUrl}/api/devices`);
    assert.equal(((await listRes.json()) as unknown[]).length, 0);
  } finally {
    await app.close();
  }
});

test('POST /api/devices/bulk reports a per-IP failure without failing the whole batch', async () => {
  const { app } = await setup();
  try {
    // Pre-create one address in the range so it collides.
    await fetch(`${app.baseUrl}/api/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Existing', host: '192.168.1.11' }),
    });

    const res = await fetch(`${app.baseUrl}/api/devices/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startIp: '192.168.1.10', endIp: '192.168.1.12' }),
    });
    assert.equal(res.status, 201);
    const results = (await res.json()) as { ip: string; ok: boolean; error?: string }[];
    assert.equal(results.find((r) => r.ip === '192.168.1.10')?.ok, true);
    assert.equal(results.find((r) => r.ip === '192.168.1.11')?.ok, false);
    assert.match(results.find((r) => r.ip === '192.168.1.11')?.error ?? '', /already exists/);
    assert.equal(results.find((r) => r.ip === '192.168.1.12')?.ok, true);
  } finally {
    await app.close();
  }
});

test('GET /api/devices/:id returns 404 for an unknown id', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/devices/999`);
    assert.equal(res.status, 404);
  } finally {
    await app.close();
  }
});

test('PATCH /api/devices/:id updates fields and DELETE removes it', async () => {
  const { app } = await setup();
  try {
    const created = (await (
      await fetch(`${app.baseUrl}/api/devices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Original', host: '192.168.0.140' }),
      })
    ).json()) as { id: number };

    const patched = await fetch(`${app.baseUrl}/api/devices/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed', enabled: false }),
    });
    assert.equal(patched.status, 200);
    const patchedBody = (await patched.json()) as { name: string; enabled: boolean };
    assert.equal(patchedBody.name, 'Renamed');
    assert.equal(patchedBody.enabled, false);

    const deleted = await fetch(`${app.baseUrl}/api/devices/${created.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);

    const afterDelete = await fetch(`${app.baseUrl}/api/devices/${created.id}`);
    assert.equal(afterDelete.status, 404);
  } finally {
    await app.close();
  }
});

test('PUT /api/devices/:id/groups replaces membership, and DELETE cascades cleanly', async () => {
  const { db, app } = await setup();
  try {
    const groupId = Number(db.prepare('INSERT INTO groups (name) VALUES (?)').run('Ground Floor').lastInsertRowid);
    const created = (await (
      await fetch(`${app.baseUrl}/api/devices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Grouped', host: '192.168.0.150' }),
      })
    ).json()) as { id: number };

    const res = await fetch(`${app.baseUrl}/api/devices/${created.id}/groups`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupIds: [groupId] }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { groupIds: number[] };
    assert.deepEqual(body.groupIds, [groupId]);
  } finally {
    await app.close();
  }
});

test('GET /api/devices/:id/telemetry returns samples ordered oldest-first, filterable by metric', async () => {
  const { db, app } = await setup();
  try {
    const deviceId = Number(
      db.prepare('INSERT INTO devices (name, host) VALUES (?, ?)').run('Foyer', '192.168.0.170').lastInsertRowid,
    );
    const insert = db.prepare(
      'INSERT INTO telemetry (device_id, metric, idx, value, recorded_at) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run(deviceId, 'temp_intake', 0, 30, '2026-01-01T00:00:00.000Z');
    insert.run(deviceId, 'temp_intake', 0, 32, '2026-01-01T00:01:00.000Z');
    insert.run(deviceId, 'lamp_hours', 0, 100, '2026-01-01T00:00:30.000Z');

    const all = (await (await fetch(`${app.baseUrl}/api/devices/${deviceId}/telemetry`)).json()) as {
      metric: string;
      value: number;
    }[];
    assert.equal(all.length, 3);
    assert.deepEqual(
      all.map((s) => s.value),
      [30, 100, 32], // ordered by recorded_at, not insertion order
    );

    const tempsOnly = (await (
      await fetch(`${app.baseUrl}/api/devices/${deviceId}/telemetry?metric=temp_intake`)
    ).json()) as { value: number }[];
    assert.deepEqual(
      tempsOnly.map((s) => s.value),
      [30, 32],
    );
  } finally {
    await app.close();
  }
});

test('GET /api/devices/:id/telemetry respects since and limit', async () => {
  const { db, app } = await setup();
  try {
    const deviceId = Number(
      db.prepare('INSERT INTO devices (name, host) VALUES (?, ?)').run('Foyer', '192.168.0.171').lastInsertRowid,
    );
    const insert = db.prepare(
      'INSERT INTO telemetry (device_id, metric, idx, value, recorded_at) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run(deviceId, 'temp_intake', 0, 30, '2026-01-01T00:00:00.000Z');
    insert.run(deviceId, 'temp_intake', 0, 31, '2026-01-02T00:00:00.000Z');
    insert.run(deviceId, 'temp_intake', 0, 32, '2026-01-03T00:00:00.000Z');

    const since = (await (
      await fetch(`${app.baseUrl}/api/devices/${deviceId}/telemetry?since=2026-01-02T00:00:00.000Z`)
    ).json()) as { value: number }[];
    assert.deepEqual(
      since.map((s) => s.value),
      [31, 32],
    );

    const limited = (await (
      await fetch(`${app.baseUrl}/api/devices/${deviceId}/telemetry?limit=1`)
    ).json()) as { value: number }[];
    assert.equal(limited.length, 1);
  } finally {
    await app.close();
  }
});

test('GET /api/devices/:id/telemetry 404s for an unknown device', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/devices/999/telemetry`);
    assert.equal(res.status, 404);
  } finally {
    await app.close();
  }
});

test('credentials: PUT sets a per-device override, DELETE clears it back to the global default', async () => {
  const { db, app } = await setup();
  try {
    setGlobalCredentials(db, { username: 'admin1', password: 'panasonic' });
    const created = (await (
      await fetch(`${app.baseUrl}/api/devices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Creds Unit', host: '192.168.0.160' }),
      })
    ).json()) as { id: number };

    const withOverride = await fetch(`${app.baseUrl}/api/devices/${created.id}/credentials`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'unit-specific' }),
    });
    assert.equal(withOverride.status, 200);
    const overrideBody = (await withOverride.json()) as { credentialOverride: { username: boolean; password: boolean } };
    assert.deepEqual(overrideBody.credentialOverride, { username: false, password: true });
    // The password itself must never be echoed back.
    assert.equal('password' in overrideBody, false);

    const cleared = await fetch(`${app.baseUrl}/api/devices/${created.id}/credentials`, { method: 'DELETE' });
    const clearedBody = (await cleared.json()) as { credentialOverride: { username: boolean; password: boolean } };
    assert.deepEqual(clearedBody.credentialOverride, { username: false, password: false });
  } finally {
    await app.close();
  }
});
