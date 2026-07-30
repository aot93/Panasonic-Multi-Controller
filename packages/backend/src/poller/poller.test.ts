process.env.PPC_SECRET_KEY = '22'.repeat(32);

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// logDeviceError (logging/error-log.ts) re-reads this lazily, so events that
// trigger CSV logging in these tests land in a throwaway temp dir instead of
// this repo's own data/logs/.
process.env.PPC_DATA_DIR = mkdtempSync(join(tmpdir(), 'ppc-test-'));
import type { DeviceEvent, DeviceState } from '@ppc/shared';
import { runMigrations } from '../db/migrate.js';
import { MockProjector } from '../protocol/mock-server.js';
import { Poller, type Broadcaster } from './poller.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

function insertDevice(db: DatabaseSync, name: string, host: string, port: number, profileId?: number): number {
  const info = db
    .prepare('INSERT INTO devices (name, host, port, profile_id) VALUES (?, ?, ?, ?)')
    .run(name, host, port, profileId ?? null);
  return Number(info.lastInsertRowid);
}

function makeRecordingBroadcaster(): Broadcaster & { states: DeviceState[]; events: DeviceEvent[] } {
  const states: DeviceState[] = [];
  const events: DeviceEvent[] = [];
  return {
    states,
    events,
    emit(event: 'device:state' | 'event:new', payload: DeviceState | DeviceEvent) {
      if (event === 'device:state') states.push(payload as DeviceState);
      else events.push(payload as DeviceEvent);
    },
  };
}

test('pollNow: writes device_state, telemetry, and broadcasts device:state', async () => {
  const db = makeDb();
  const mock = new MockProjector({
    protectMode: 'none',
    initialState: { power: 'on', tempIntakeC: 33, tempExhaustC: 37, lampHours: [500] },
  });
  const port = await mock.listen();
  const broadcaster = makeRecordingBroadcaster();

  try {
    const deviceId = insertDevice(db, 'Foyer', '127.0.0.1', port);
    const poller = new Poller(db, broadcaster);
    await poller.pollNow([deviceId]);

    const state = db.prepare('SELECT * FROM device_state WHERE device_id = ?').get(deviceId) as Record<
      string,
      unknown
    >;
    assert.equal(state.health, 'ok');
    assert.equal(state.power, 'on');
    assert.equal(state.temp_intake_c, 33);
    assert.equal(state.temp_exhaust_c, 37);
    assert.deepEqual(JSON.parse(state.lamp_hours as string), [500]);

    const telemetryCount = db.prepare('SELECT COUNT(*) AS n FROM telemetry WHERE device_id = ?').get(deviceId) as {
      n: number;
    };
    // temp_intake, temp_exhaust, ac_voltage, lamp_hours x1, latency_ms = 5 rows
    assert.equal(telemetryCount.n, 5);

    assert.equal(state.input, 'HD1');
    assert.equal(state.shutter, 0);

    assert.equal(broadcaster.states.length, 1);
    assert.equal(broadcaster.states[0]?.health, 'ok');
    assert.equal(broadcaster.states[0]?.deviceId, deviceId);
  } finally {
    await mock.close();
  }
});

test('pollNow: a device with no credentials configured in protect mode is unreachable, not silently ok', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'md5' });
  const port = await mock.listen();
  const broadcaster = makeRecordingBroadcaster();

  try {
    const deviceId = insertDevice(db, 'Locked Room', '127.0.0.1', port);
    const poller = new Poller(db, broadcaster);
    await poller.pollNow([deviceId]);

    const state = db.prepare('SELECT health, last_error FROM device_state WHERE device_id = ?').get(deviceId) as {
      health: string;
      last_error: string | null;
    };
    assert.equal(state.health, 'unreachable');
    assert.ok(state.last_error);
  } finally {
    await mock.close();
  }
});

test('pollNow: uses the command profile\'s lamp_count to decide how many lamps to query', async () => {
  const db = makeDb();
  const profileId = Number(
    db
      .prepare('INSERT INTO command_profiles (name, lamp_count) VALUES (?, ?)')
      .run('Test 2-lamp profile', 2).lastInsertRowid,
  );
  const mock = new MockProjector({ protectMode: 'none', initialState: { lampHours: [111, 222] } });
  const port = await mock.listen();

  try {
    const deviceId = insertDevice(db, 'Dual Lamp Unit', '127.0.0.1', port, profileId);
    const poller = new Poller(db, null);
    await poller.pollNow([deviceId]);

    const state = db.prepare('SELECT lamp_hours FROM device_state WHERE device_id = ?').get(deviceId) as {
      lamp_hours: string;
    };
    assert.deepEqual(JSON.parse(state.lamp_hours), [111, 222]);
  } finally {
    await mock.close();
  }
});

test('pollNow: raises comms.lost then comms.restored across two polls, and updates health accordingly', async () => {
  const db = makeDb();
  const broadcaster = makeRecordingBroadcaster();
  const poller = new Poller(db, broadcaster);

  const downMock = new MockProjector({ protectMode: 'none' });
  const port = await downMock.listen();
  await downMock.close(); // nothing listening — device is "configured but down"

  const deviceId = insertDevice(db, 'Flaky Projector', '127.0.0.1', port);

  await poller.pollNow([deviceId]);
  const afterFirst = db.prepare('SELECT health FROM device_state WHERE device_id = ?').get(deviceId) as {
    health: string;
  };
  assert.equal(afterFirst.health, 'unreachable');
  assert.equal(broadcaster.events.length, 1);
  assert.equal(broadcaster.events[0]?.code, 'comms.lost');
  assert.equal(broadcaster.events[0]?.severity, 'error');

  // Same port comes back up.
  const upMock = new MockProjector({ protectMode: 'none' });
  await upMock.listen(port);
  try {
    await poller.pollNow([deviceId]);
    const afterSecond = db.prepare('SELECT health FROM device_state WHERE device_id = ?').get(deviceId) as {
      health: string;
    };
    assert.equal(afterSecond.health, 'ok');
    assert.equal(broadcaster.events.length, 2);
    assert.equal(broadcaster.events[1]?.code, 'comms.restored');
    assert.equal(broadcaster.events[1]?.severity, 'info');
  } finally {
    await upMock.close();
  }
});

test('pollNow: no event raised when health does not change between polls', async () => {
  const db = makeDb();
  const broadcaster = makeRecordingBroadcaster();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();

  try {
    const deviceId = insertDevice(db, 'Steady Projector', '127.0.0.1', port);
    const poller = new Poller(db, broadcaster);

    await poller.pollNow([deviceId]);
    // unknown -> ok on first-ever poll isn't a "recovery" (nothing was ever
    // wrong), so no event here — only unreachable/warning/error -> ok is.
    assert.equal(broadcaster.events.length, 0);

    await poller.pollNow([deviceId]);
    assert.equal(broadcaster.events.length, 0); // ok -> ok again, still no event
    assert.equal(broadcaster.states.length, 2); // state still broadcasts every poll
  } finally {
    await mock.close();
  }
});

test('pollNow: a self-diagnosis error code (e.g. real-hardware-confirmed U300) raises a critical event and logs the related sensor value', async () => {
  const db = makeDb();
  const broadcaster = makeRecordingBroadcaster();
  const mock = new MockProjector({ protectMode: 'none', initialState: { tempIntakeC: 60, errs2: 'U300' } });
  const port = await mock.listen();

  try {
    const deviceId = insertDevice(db, 'Overheating Unit', '127.0.0.1', port);
    const poller = new Poller(db, broadcaster);
    await poller.pollNow([deviceId]);

    const state = db.prepare('SELECT health, self_diagnosis FROM device_state WHERE device_id = ?').get(deviceId) as {
      health: string;
      self_diagnosis: string | null;
    };
    assert.equal(state.health, 'error');
    assert.match(state.self_diagnosis ?? '', /U300/);

    assert.equal(broadcaster.events[0]?.code, 'selfdiag.error');
    assert.equal(broadcaster.events[0]?.severity, 'critical');
    assert.match(broadcaster.events[0]?.message ?? '', /U300/);
    // "Log the values from sensors related to the error" — U300 is temperature-related, so the current intake reading should be attached.
    assert.match(broadcaster.events[0]?.detail ?? '', /Intake 60/);
  } finally {
    await mock.close();
  }
});

test('pollNow: a voltage-related self-diagnosis code logs the current voltage reading, not temperature', async () => {
  const db = makeDb();
  const broadcaster = makeRecordingBroadcaster();
  const mock = new MockProjector({ protectMode: 'none', initialState: { acVoltageRaw: 85, errs2: 'U081' } });
  const port = await mock.listen();

  try {
    const deviceId = insertDevice(db, 'Brownout Unit', '127.0.0.1', port);
    const poller = new Poller(db, broadcaster);
    await poller.pollNow([deviceId]);

    const state = db.prepare('SELECT health FROM device_state WHERE device_id = ?').get(deviceId) as {
      health: string;
    };
    assert.equal(state.health, 'warning');
    assert.equal(broadcaster.events[0]?.code, 'selfdiag.warning');
    assert.match(broadcaster.events[0]?.detail ?? '', /AC Voltage 85/);
    assert.equal(/Intake|Exhaust/.test(broadcaster.events[0]?.detail ?? ''), false);
  } finally {
    await mock.close();
  }
});

test('pollNow: an active ERRS1 position still changes health and raises an event, but is suppressed from the display text', async () => {
  const db = makeDb();
  const broadcaster = makeRecordingBroadcaster();
  // Position 3 active ('N' x2, 'E', 'N' x2) — no ERRS2 code, so ERRS1 is the only active finding.
  const mock = new MockProjector({ protectMode: 'none', initialState: { errs1: 'NNENN' } });
  const port = await mock.listen();

  try {
    const deviceId = insertDevice(db, 'Mystery Fault Unit', '127.0.0.1', port);
    const poller = new Poller(db, broadcaster);
    await poller.pollNow([deviceId]);

    const state = db.prepare('SELECT health, self_diagnosis FROM device_state WHERE device_id = ?').get(deviceId) as {
      health: string;
      self_diagnosis: string | null;
    };
    // Still affects health/severity...
    assert.equal(state.health, 'warning');
    assert.equal(broadcaster.events.length, 1);
    assert.equal(broadcaster.events[0]?.code, 'selfdiag.warning');
    // ...but the confusing "position N" text is suppressed from what's displayed.
    assert.equal(state.self_diagnosis, null);
    assert.equal(/position/i.test(broadcaster.events[0]?.message ?? ''), false);
    assert.match(broadcaster.events[0]?.message ?? '', /reports a warning/);
  } finally {
    await mock.close();
  }
});

test('pollNow: an info-severity self-diagnosis finding (e.g. H001) is stored but does not affect health or raise an event', async () => {
  const db = makeDb();
  const broadcaster = makeRecordingBroadcaster();
  const mock = new MockProjector({ protectMode: 'none', initialState: { errs2: 'H001' } });
  const port = await mock.listen();

  try {
    const deviceId = insertDevice(db, 'Old Clock Unit', '127.0.0.1', port);
    const poller = new Poller(db, broadcaster);
    await poller.pollNow([deviceId]);

    const state = db.prepare('SELECT health, self_diagnosis FROM device_state WHERE device_id = ?').get(deviceId) as {
      health: string;
      self_diagnosis: string | null;
    };
    assert.equal(state.health, 'ok');
    assert.match(state.self_diagnosis ?? '', /H001/);
    assert.equal(broadcaster.events.length, 0);
  } finally {
    await mock.close();
  }
});

test('Poller: pause() stops the automatic cycle, but pollNow() still works', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const deviceId = insertDevice(db, 'Paused Test', '127.0.0.1', port);
    const poller = new Poller(db, null, 20); // fast tick, just for this test
    poller.pause();
    assert.equal(poller.isPaused, true);
    poller.start();
    await new Promise((r) => setTimeout(r, 80)); // several tick intervals
    poller.stop();

    const stateWhilePaused = db.prepare('SELECT * FROM device_state WHERE device_id = ?').get(deviceId);
    assert.equal(stateWhilePaused, undefined); // the automatic cycle never ran

    // "sending of commands are still allowed" — an explicit pollNow() bypasses the pause entirely.
    await poller.pollNow([deviceId]);
    const stateAfterManual = db.prepare('SELECT health FROM device_state WHERE device_id = ?').get(deviceId) as
      | { health: string }
      | undefined;
    assert.ok(stateAfterManual);

    poller.resume();
    assert.equal(poller.isPaused, false);
  } finally {
    await mock.close();
  }
});

test('pollNow: disabled devices are skipped', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();

  try {
    const deviceId = insertDevice(db, 'Disabled Unit', '127.0.0.1', port);
    db.prepare('UPDATE devices SET enabled = 0 WHERE id = ?').run(deviceId);

    const poller = new Poller(db, null);
    await poller.pollNow(); // all enabled devices — should be none

    const state = db.prepare('SELECT * FROM device_state WHERE device_id = ?').get(deviceId);
    assert.equal(state, undefined);
  } finally {
    await mock.close();
  }
});

test('pollNow: an empty deviceIds array polls nothing', async () => {
  const db = makeDb();
  const poller = new Poller(db, null);
  await assert.doesNotReject(() => poller.pollNow([]));
});
