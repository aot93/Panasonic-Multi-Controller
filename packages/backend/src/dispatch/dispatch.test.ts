process.env.PPC_SECRET_KEY = '55'.repeat(32);

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// See poller.test.ts — logDeviceError writes real CSV files, redirected here to a throwaway temp dir.
process.env.PPC_DATA_DIR = mkdtempSync(join(tmpdir(), 'ppc-test-'));
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { MockProjector } from '../protocol/mock-server.js';
import { createDispatcher, type PollTrigger } from './dispatch.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  seed(db);
  return db;
}

function insertDevice(db: DatabaseSync, name: string, host: string, port: number): number {
  return Number(db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run(name, host, port).lastInsertRowid);
}

function fakePoller(): PollTrigger & { calls: (number[] | undefined)[] } {
  const calls: (number[] | undefined)[] = [];
  return {
    calls,
    async pollNow(deviceIds) {
      calls.push(deviceIds);
    },
  };
}

test('dispatch: a single device target sends the command and logs the result', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const port = await mock.listen();
  try {
    const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', port);
    const dispatch = createDispatcher(db, null, fakePoller());

    const { results } = await dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'power.on' }, null, 'ui');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.ok, true);
    assert.equal(results[0]?.deviceId, deviceId);

    const logged = db.prepare('SELECT * FROM command_log WHERE device_id = ?').get(deviceId) as {
      command_key: string;
      ok: number;
      source: string;
    };
    assert.equal(logged.command_key, 'power.on');
    assert.equal(logged.ok, 1);
    assert.equal(logged.source, 'ui');
  } finally {
    await mock.close();
  }
});

test('dispatch: a non-query command triggers an immediate follow-up poll of the affected devices', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', port);
    const poller = fakePoller();
    const dispatch = createDispatcher(db, null, poller);

    await dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'power.on' }, null, 'ui');
    assert.deepEqual(poller.calls, [[deviceId]]);
  } finally {
    await mock.close();
  }
});

test('dispatch: a query command does NOT trigger a follow-up poll', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', port);
    const poller = fakePoller();
    const dispatch = createDispatcher(db, null, poller);

    await dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'power.query' }, null, 'ui');
    assert.deepEqual(poller.calls, []);
  } finally {
    await mock.close();
  }
});

test('dispatch: group target fans out to every enabled device in the group', async () => {
  const db = makeDb();
  const mockA = new MockProjector({ protectMode: 'none' });
  const mockB = new MockProjector({ protectMode: 'none' });
  const portA = await mockA.listen();
  const portB = await mockB.listen();
  try {
    const deviceA = insertDevice(db, 'A', '127.0.0.1', portA);
    const deviceB = insertDevice(db, 'B', '127.0.0.1', portB);
    const groupId = Number(db.prepare('INSERT INTO groups (name) VALUES (?)').run('Both').lastInsertRowid);
    db.prepare('INSERT INTO device_groups (device_id, group_id) VALUES (?, ?), (?, ?)').run(
      deviceA,
      groupId,
      deviceB,
      groupId,
    );

    const dispatch = createDispatcher(db, null, fakePoller());
    const { results } = await dispatch({ kind: 'group', ids: [groupId] }, { commandKey: 'power.query' }, null, 'ui');
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.ok));
  } finally {
    await mockA.close();
    await mockB.close();
  }
});

test('dispatch: "all" targets every enabled device and skips disabled ones', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const enabledId = insertDevice(db, 'Enabled', '127.0.0.1', port);
    const disabledId = insertDevice(db, 'Disabled', '127.0.0.1', port + 1);
    db.prepare('UPDATE devices SET enabled = 0 WHERE id = ?').run(disabledId);

    const dispatch = createDispatcher(db, null, fakePoller());
    const { results } = await dispatch({ kind: 'all' }, { commandKey: 'power.query' }, null, 'ui');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.deviceId, enabledId);
  } finally {
    await mock.close();
  }
});

test('dispatch: enum param must be one of the catalogue options', async () => {
  const db = makeDb();
  const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', 1);
  const dispatch = createDispatcher(db, null, fakePoller());

  await assert.rejects(
    () => dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'aspect.set' }, 'not-a-real-option', 'ui'),
    /param must be one of/,
  );
});

test('dispatch: enum param succeeds when it matches a catalogue option', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', port);
    const dispatch = createDispatcher(db, null, fakePoller());
    const { results } = await dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'aspect.set' }, '6', 'ui');
    assert.equal(results[0]?.ok, true);
  } finally {
    await mock.close();
  }
});

test('dispatch: integer param out of range is rejected before touching any device', async () => {
  const db = makeDb();
  const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', 1);
  const dispatch = createDispatcher(db, null, fakePoller());

  await assert.rejects(
    () => dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'lamp.hours.query' }, '99', 'ui'),
    /param must be <= 4/,
  );
});

test('dispatch: NextSteps.md phase 3 enum commands are seeded and validate correctly', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', port);
    const dispatch = createDispatcher(db, null, fakePoller());

    await assert.rejects(
      () => dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'logo.set' }, 'not-a-real-option', 'ui'),
      /param must be one of/,
    );

    // Shutter fade in/out use literal decimal-string enum values (not a numeric range) — "2.5" must pass
    // validation (the mock doesn't implement this command's wire body, so only the validation layer is asserted here).
    await assert.rejects(
      () => dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'shutter.fadein.set' }, '6.0', 'ui'),
      /param must be one of/,
    );
    await assert.doesNotReject(() => dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'shutter.fadein.set' }, '2.5', 'ui'));
  } finally {
    await mock.close();
  }
});

test('dispatch: input.set accepts the full slot enumeration (phase 3 item 2), not just the old abridged subset', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', port);
    const dispatch = createDispatcher(db, null, fakePoller());

    await assert.rejects(
      () => dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'input.set' }, 'not-a-real-input', 'ui'),
      /param must be one of/,
    );

    // AU2,HD3 (slot 2, HDMI 3) was not in the original abridged INPUT_OPTIONS list — slot 2 continues HDMI numbering from slot 1 rather than restarting.
    const { results } = await dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'input.set' }, 'AU2,HD3', 'ui');
    assert.equal(results[0]?.ok, true);
  } finally {
    await mock.close();
  }
});

test('dispatch: string param may not be empty', async () => {
  const db = makeDb();
  db.prepare(
    `INSERT INTO commands (key, label, category, body, is_query, param_kind)
     VALUES ('custom.free', 'Free text', 'General', 'NCGS0=+{p}', 0, 'string')`,
  ).run();
  const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', 1);
  const dispatch = createDispatcher(db, null, fakePoller());

  await assert.rejects(() => dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'custom.free' }, '', 'ui'));
});

test('dispatch: unknown commandKey throws not-found', async () => {
  const db = makeDb();
  const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', 1);
  const dispatch = createDispatcher(db, null, fakePoller());

  await assert.rejects(() => dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'no.such.command' }, null, 'ui'));
});

test('dispatch: neither commandId nor commandKey is a bad request', async () => {
  const db = makeDb();
  const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', 1);
  const dispatch = createDispatcher(db, null, fakePoller());

  await assert.rejects(
    () => dispatch({ kind: 'device', ids: [deviceId] }, {}, null, 'ui'),
    /Either commandId or commandKey/,
  );
});

test('dispatch: a target that resolves to zero devices is a bad request, not an empty success', async () => {
  const db = makeDb();
  const dispatch = createDispatcher(db, null, fakePoller());

  await assert.rejects(
    () => dispatch({ kind: 'device', ids: [999999] }, { commandKey: 'power.on' }, null, 'ui'),
    /zero enabled devices/,
  );
});

test('dispatch: an unreachable device produces a failed result for that device without throwing', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  await mock.close(); // nothing listening
  const deviceId = insertDevice(db, 'Down', '127.0.0.1', port);
  const dispatch = createDispatcher(db, null, fakePoller());

  const { results } = await dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'power.on' }, null, 'ui');
  assert.equal(results[0]?.ok, false);
  assert.ok(results[0]?.error);
});

test('dispatch: a failed command writes an events row and broadcasts event:new (not just command_log)', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  await mock.close(); // nothing listening
  const deviceId = insertDevice(db, 'Down', '127.0.0.1', port);

  const emitted: { event: string; payload: unknown }[] = [];
  const dispatch = createDispatcher(
    db,
    { emit: (event: 'dispatch:result' | 'event:new', payload) => void emitted.push({ event, payload }) },
    fakePoller(),
  );

  await dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'power.on' }, null, 'ui');

  const eventRow = db.prepare('SELECT * FROM events WHERE device_id = ?').get(deviceId) as {
    severity: string;
    code: string;
    message: string;
  };
  assert.equal(eventRow.severity, 'error');
  assert.ok(eventRow.message);

  const eventNew = emitted.find((e) => e.event === 'event:new');
  assert.ok(eventNew);
});

test('dispatch: a successful command does NOT write an events row', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', port);
    const dispatch = createDispatcher(db, null, fakePoller());
    await dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'power.on' }, null, 'ui');

    const count = db.prepare('SELECT COUNT(*) AS n FROM events WHERE device_id = ?').get(deviceId) as { n: number };
    assert.equal(count.n, 0);
  } finally {
    await mock.close();
  }
});

test('dispatch: broadcasts dispatch:result over the given broadcaster', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', port);
    const emitted: unknown[] = [];
    const dispatch = createDispatcher(db, { emit: (_e, payload) => void emitted.push(payload) }, fakePoller());

    const { dispatchId } = await dispatch({ kind: 'device', ids: [deviceId] }, { commandKey: 'power.on' }, null, 'ui');
    assert.equal(emitted.length, 1);
    assert.equal((emitted[0] as { dispatchId: string }).dispatchId, dispatchId);
  } finally {
    await mock.close();
  }
});
