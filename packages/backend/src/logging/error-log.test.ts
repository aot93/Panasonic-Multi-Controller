import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Read lazily inside logDeviceError — see the comment at the top of
// error-log.ts — so this must be set before each call, not just before import.
process.env.PPC_DATA_DIR = mkdtempSync(join(tmpdir(), 'ppc-test-'));

import { logDeviceError } from './error-log.js';

test('logDeviceError: creates a per-device CSV file with a header row', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ppc-test-'));
  process.env.PPC_DATA_DIR = dataDir;

  logDeviceError({
    deviceId: 1,
    deviceName: 'Foyer',
    host: '192.168.0.101',
    severity: 'error',
    code: 'comms.lost',
    message: 'Connection refused',
  });

  const files = readdirSync(join(dataDir, 'logs'));
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^device-1-192_168_0_101\.csv$/);

  const content = readFileSync(join(dataDir, 'logs', files[0]!), 'utf8');
  const lines = content.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'timestamp,device_id,device_name,host,severity,code,message,detail');
  assert.match(lines[1]!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3},1,Foyer,192\.168\.0\.101,error,comms\.lost,Connection refused,$/);
});

test('logDeviceError: appends without repeating the header', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ppc-test-'));
  process.env.PPC_DATA_DIR = dataDir;

  const entry = { deviceId: 2, deviceName: 'Lobby', host: '192.168.0.102', severity: 'error', code: 'comms.lost', message: 'first' };
  logDeviceError(entry);
  logDeviceError({ ...entry, message: 'second' });

  const files = readdirSync(join(dataDir, 'logs'));
  const content = readFileSync(join(dataDir, 'logs', files[0]!), 'utf8');
  const lines = content.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1]!, /first/);
  assert.match(lines[2]!, /second/);
});

test('logDeviceError: separate devices get separate files', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ppc-test-'));
  process.env.PPC_DATA_DIR = dataDir;

  logDeviceError({ deviceId: 1, deviceName: 'A', host: '10.0.0.1', severity: 'error', code: 'x', message: 'm' });
  logDeviceError({ deviceId: 2, deviceName: 'B', host: '10.0.0.2', severity: 'error', code: 'x', message: 'm' });

  assert.equal(readdirSync(join(dataDir, 'logs')).length, 2);
});

test('logDeviceError: fields with commas/quotes are CSV-escaped', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ppc-test-'));
  process.env.PPC_DATA_DIR = dataDir;

  logDeviceError({
    deviceId: 3,
    deviceName: 'Room, East',
    host: '10.0.0.3',
    severity: 'error',
    code: 'x',
    message: 'Said "hello"',
  });

  const files = readdirSync(join(dataDir, 'logs'));
  const content = readFileSync(join(dataDir, 'logs', files[0]!), 'utf8');
  assert.match(content, /"Room, East"/);
  assert.match(content, /"Said ""hello"""/);
});
