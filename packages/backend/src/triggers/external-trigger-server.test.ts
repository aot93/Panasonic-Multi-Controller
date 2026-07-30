process.env.PPC_SECRET_KEY = '77'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { createSocket } from 'node:dgram';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { setSetting } from '../poller/settings.js';
import { createDispatcher } from '../dispatch/dispatch.js';
import { MockProjector } from '../protocol/mock-server.js';
import { ExternalTriggerServer } from './external-trigger-server.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  seed(db);
  return db;
}

function enableTriggers(db: DatabaseSync, tcpPort: number, udpPort: number): void {
  setSetting(db, 'external_trigger_enabled', '1');
  setSetting(db, 'external_trigger_tcp_port', String(tcpPort));
  setSetting(db, 'external_trigger_udp_port', String(udpPort));
}

function sendTcp(port: number, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(message + '\n');
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString('utf8')));
    socket.on('end', () => resolve(data.trim()));
    socket.on('error', reject);
  });
}

function sendUdp(port: number, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    socket.on('message', (msg) => {
      socket.close();
      resolve(msg.toString('utf8'));
    });
    socket.on('error', reject);
    socket.send(message, port, '127.0.0.1');
    setTimeout(() => reject(new Error('UDP response timed out')), 2000).unref();
  });
}

test('ExternalTriggerServer: does not bind any sockets when disabled (the default)', async () => {
  const db = makeDb();
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const server = new ExternalTriggerServer(db, dispatch);
  await server.start();
  assert.equal(server.isRunning, false);
  await server.stop();
});

test('ExternalTriggerServer: TCP fires the configured command against the target device', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const mockPort = await mock.listen();
  const deviceId = Number(
    db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', mockPort)
      .lastInsertRowid,
  );
  const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.on'").get()!.id);
  db.prepare(
    `INSERT INTO external_triggers (trigger_key, target_kind, target_id, action_kind, action_id)
     VALUES ('LOBBY_ON', 'device', ?, 'command', ?)`,
  ).run(deviceId, commandId);

  enableTriggers(db, 19100, 19101);
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const server = new ExternalTriggerServer(db, dispatch);
  await server.start();

  try {
    const response = await sendTcp(19100, 'LOBBY_ON');
    assert.equal(response, 'OK');

    const fired = db.prepare("SELECT last_fired_at FROM external_triggers WHERE trigger_key = 'LOBBY_ON'").get() as {
      last_fired_at: string | null;
    };
    assert.ok(fired.last_fired_at);
  } finally {
    await server.stop();
    await mock.close();
  }
});

test('ExternalTriggerServer: UDP fires the same way and acks back to the sender', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none' });
  const mockPort = await mock.listen();
  const deviceId = Number(
    db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', mockPort)
      .lastInsertRowid,
  );
  const commandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.off'").get()!.id);
  db.prepare(
    `INSERT INTO external_triggers (trigger_key, target_kind, target_id, action_kind, action_id)
     VALUES ('LOBBY_OFF', 'device', ?, 'command', ?)`,
  ).run(deviceId, commandId);

  enableTriggers(db, 19102, 19103);
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const server = new ExternalTriggerServer(db, dispatch);
  await server.start();

  try {
    const response = await sendUdp(19103, 'LOBBY_OFF');
    assert.equal(response, 'OK');
  } finally {
    await server.stop();
    await mock.close();
  }
});

test('ExternalTriggerServer: an unknown trigger key gets an ERR response, not a crash', async () => {
  const db = makeDb();
  enableTriggers(db, 19104, 19105);
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const server = new ExternalTriggerServer(db, dispatch);
  await server.start();

  try {
    const response = await sendTcp(19104, 'NO_SUCH_KEY');
    assert.match(response, /^ERR/);
  } finally {
    await server.stop();
  }
});

test('ExternalTriggerServer: a disabled trigger row is treated as unknown', async () => {
  const db = makeDb();
  db.prepare(
    `INSERT INTO external_triggers (trigger_key, enabled, target_kind, action_kind, action_id)
     VALUES ('DISABLED_ONE', 0, 'all', 'command', 1)`,
  ).run();
  enableTriggers(db, 19106, 19107);
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const server = new ExternalTriggerServer(db, dispatch);
  await server.start();

  try {
    const response = await sendTcp(19106, 'DISABLED_ONE');
    assert.match(response, /^ERR/);
  } finally {
    await server.stop();
  }
});

test('ExternalTriggerServer: a macro-action trigger with no such macro fails gracefully, not silently', async () => {
  const db = makeDb();
  db.prepare(
    `INSERT INTO external_triggers (trigger_key, target_kind, action_kind, action_id)
     VALUES ('MACRO_ONE', 'all', 'macro', 999)`,
  ).run();
  enableTriggers(db, 19108, 19109);
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const server = new ExternalTriggerServer(db, dispatch);
  await server.start();

  try {
    const response = await sendTcp(19108, 'MACRO_ONE');
    assert.match(response, /^ERR/);
  } finally {
    await server.stop();
  }
});

test('ExternalTriggerServer: a real macro-action trigger actually runs the macro\'s steps', async () => {
  const db = makeDb();
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const mockPort = await mock.listen();
  try {
    db.prepare('INSERT INTO devices (name, host, port) VALUES (?, ?, ?)').run('Foyer', '127.0.0.1', mockPort);
    const onCommandId = Number(db.prepare("SELECT id FROM commands WHERE key = 'power.on'").get()!.id);
    const macroId = Number(db.prepare('INSERT INTO macros (name) VALUES (?)').run('Turn On').lastInsertRowid);
    db.prepare(
      'INSERT INTO macro_steps (macro_id, seq, command_id, delay_ms_after) VALUES (?, 0, ?, 0)',
    ).run(macroId, onCommandId);
    db.prepare(
      `INSERT INTO external_triggers (trigger_key, target_kind, action_kind, action_id)
       VALUES ('MACRO_RUN', 'all', 'macro', ?)`,
    ).run(macroId);

    enableTriggers(db, 19113, 19114);
    const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
    const server = new ExternalTriggerServer(db, dispatch);
    await server.start();

    try {
      const response = await sendTcp(19113, 'MACRO_RUN');
      assert.equal(response, 'OK');
      assert.equal(mock.state.power, 'on');
    } finally {
      await server.stop();
    }
  } finally {
    await mock.close();
  }
});

test('ExternalTriggerServer: restart() picks up a changed port', async () => {
  const db = makeDb();
  enableTriggers(db, 19110, 19111);
  const dispatch = createDispatcher(db, null, { pollNow: async () => {} });
  const server = new ExternalTriggerServer(db, dispatch);
  await server.start();

  try {
    setSetting(db, 'external_trigger_tcp_port', '19112');
    await server.restart();

    await assert.rejects(() => sendTcp(19110, 'X'));
    const response = await sendTcp(19112, 'ANY_KEY');
    assert.match(response, /^ERR/); // reaches the new port; key just doesn't exist
  } finally {
    await server.stop();
  }
});
