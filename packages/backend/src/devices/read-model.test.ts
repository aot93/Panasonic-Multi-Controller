process.env.PPC_SECRET_KEY = '33'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { setDeviceCredentials, setGlobalCredentials } from '../credentials/store.js';
import { Poller } from '../poller/poller.js';
import { MockProjector } from '../protocol/mock-server.js';
import { getDeviceWithState, listDevicesWithState } from './read-model.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

test('listDevicesWithState: a never-polled device has state: null and an empty groupIds array', () => {
  const db = makeDb();
  db.prepare('INSERT INTO devices (name, host) VALUES (?, ?)').run('Fresh Install', '192.168.0.200');

  const [device] = listDevicesWithState(db);
  assert.equal(device?.name, 'Fresh Install');
  assert.equal(device?.state, null);
  assert.deepEqual(device?.groupIds, []);
  assert.deepEqual(device?.credentialOverride, { username: false, password: false });
});

test('listDevicesWithState: reports which credential fields are overridden per device, without ever exposing the secret', () => {
  const db = makeDb();
  setGlobalCredentials(db, { username: 'admin1', password: 'panasonic' });
  const deviceId = Number(
    db.prepare('INSERT INTO devices (name, host) VALUES (?, ?)').run('Custom Creds Unit', '192.168.0.201')
      .lastInsertRowid,
  );
  setDeviceCredentials(db, deviceId, { password: 'unit-specific' });

  const device = getDeviceWithState(db, deviceId);
  assert.deepEqual(device?.credentialOverride, { username: false, password: true });
  assert.equal((device as unknown as { password_enc?: unknown }).password_enc, undefined);
});

test('getDeviceWithState: returns null for an unknown id', () => {
  const db = makeDb();
  assert.equal(getDeviceWithState(db, 999), null);
});

test('listDevicesWithState: reflects a real poll result and group membership', async () => {
  const db = makeDb();
  const mock = new MockProjector({
    protectMode: 'none',
    initialState: { power: 'on', tempIntakeC: 34, lampHours: [42] },
  });
  const port = await mock.listen();

  try {
    const deviceId = Number(
      db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', port)
        .lastInsertRowid,
    );
    const groupId = Number(db.prepare('INSERT INTO groups (name) VALUES (?)').run('Ground Floor').lastInsertRowid);
    db.prepare('INSERT INTO device_groups (device_id, group_id) VALUES (?, ?)').run(deviceId, groupId);

    await new Poller(db, null).pollNow([deviceId]);

    const [device] = listDevicesWithState(db);
    assert.equal(device?.state?.health, 'ok');
    assert.equal(device?.state?.power, 'on');
    assert.equal(device?.state?.tempIntakeC, 34);
    assert.deepEqual(device?.state?.lampHours, [42]);
    assert.deepEqual(device?.groupIds, [groupId]);
    // Passwords must never appear in the read model, even accidentally.
    assert.equal('password' in (device ?? {}), false);
    assert.equal('password_enc' in (device ?? {}), false);
  } finally {
    await mock.close();
  }
});
