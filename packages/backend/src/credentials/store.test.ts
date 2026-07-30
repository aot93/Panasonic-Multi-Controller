// Fixed test key so encryptSecret/decryptSecret never touch disk for a
// generated key file — keeps this test hermetic.
process.env.PPC_SECRET_KEY = '11'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import {
  clearGlobalCredentials,
  ensureDefaultCredentials,
  getDeviceCredentials,
  getGlobalCredentials,
  setDeviceCredentials,
  setGlobalCredentials,
} from './store.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

function insertDevice(db: DatabaseSync, host: string): number {
  const info = db.prepare('INSERT INTO devices (name, host) VALUES (?, ?)').run(`Device ${host}`, host);
  return Number(info.lastInsertRowid);
}

test('getGlobalCredentials: null when nothing configured', () => {
  const db = makeDb();
  assert.equal(getGlobalCredentials(db), null);
});

test('setGlobalCredentials / getGlobalCredentials round trip', () => {
  const db = makeDb();
  setGlobalCredentials(db, { username: 'admin1', password: 'panasonic' });
  assert.deepEqual(getGlobalCredentials(db), { username: 'admin1', password: 'panasonic' });
});

test('setGlobalCredentials: updating replaces the previous value, not duplicates it', () => {
  const db = makeDb();
  setGlobalCredentials(db, { username: 'admin1', password: 'first' });
  setGlobalCredentials(db, { username: 'admin1', password: 'second' });
  assert.deepEqual(getGlobalCredentials(db), { username: 'admin1', password: 'second' });
});

test('clearGlobalCredentials removes the default', () => {
  const db = makeDb();
  setGlobalCredentials(db, { username: 'admin1', password: 'panasonic' });
  clearGlobalCredentials(db);
  assert.equal(getGlobalCredentials(db), null);
});

test('getDeviceCredentials: falls back entirely to the global default', () => {
  const db = makeDb();
  setGlobalCredentials(db, { username: 'admin1', password: 'panasonic' });
  const deviceId = insertDevice(db, '192.168.0.131');
  assert.deepEqual(getDeviceCredentials(db, deviceId), { username: 'admin1', password: 'panasonic' });
});

test('getDeviceCredentials: a full per-device override wins outright', () => {
  const db = makeDb();
  setGlobalCredentials(db, { username: 'admin1', password: 'panasonic' });
  const deviceId = insertDevice(db, '192.168.0.132');
  setDeviceCredentials(db, deviceId, { username: 'dispadmin', password: '@Panasonic' });
  assert.deepEqual(getDeviceCredentials(db, deviceId), { username: 'dispadmin', password: '@Panasonic' });
});

test('getDeviceCredentials: overriding only the password still inherits the global username', () => {
  const db = makeDb();
  setGlobalCredentials(db, { username: 'admin1', password: 'panasonic' });
  const deviceId = insertDevice(db, '192.168.0.133');
  setDeviceCredentials(db, deviceId, { password: 'unit-specific-password' });
  assert.deepEqual(getDeviceCredentials(db, deviceId), {
    username: 'admin1',
    password: 'unit-specific-password',
  });
});

test('getDeviceCredentials: overriding only the username still inherits the global password', () => {
  const db = makeDb();
  setGlobalCredentials(db, { username: 'admin1', password: 'panasonic' });
  const deviceId = insertDevice(db, '192.168.0.134');
  setDeviceCredentials(db, deviceId, { username: 'unit-specific-user' });
  assert.deepEqual(getDeviceCredentials(db, deviceId), {
    username: 'unit-specific-user',
    password: 'panasonic',
  });
});

test('getDeviceCredentials: null when neither global nor device credentials are configured', () => {
  const db = makeDb();
  const deviceId = insertDevice(db, '192.168.0.135');
  assert.equal(getDeviceCredentials(db, deviceId), null);
});

test('getDeviceCredentials: device-only username with no global password configured is incomplete, not a guess', () => {
  const db = makeDb();
  const deviceId = insertDevice(db, '192.168.0.136');
  setDeviceCredentials(db, deviceId, { username: 'someone' });
  assert.equal(getDeviceCredentials(db, deviceId), null);
});

test('setDeviceCredentials: clearing an override with null falls back to global again', () => {
  const db = makeDb();
  setGlobalCredentials(db, { username: 'admin1', password: 'panasonic' });
  const deviceId = insertDevice(db, '192.168.0.137');
  setDeviceCredentials(db, deviceId, { username: 'temp-user', password: 'temp-pass' });
  setDeviceCredentials(db, deviceId, { username: null, password: null });
  assert.deepEqual(getDeviceCredentials(db, deviceId), { username: 'admin1', password: 'panasonic' });
});

test('getDeviceCredentials: unknown device id returns null', () => {
  const db = makeDb();
  setGlobalCredentials(db, { username: 'admin1', password: 'panasonic' });
  assert.equal(getDeviceCredentials(db, 999), null);
});

test('ensureDefaultCredentials: seeds the Panasonic factory default when nothing is configured', () => {
  const db = makeDb();
  ensureDefaultCredentials(db);
  assert.deepEqual(getGlobalCredentials(db), { username: 'dispadmin', password: '@Panasonic' });
});

test('ensureDefaultCredentials: never overwrites an operator-configured default', () => {
  const db = makeDb();
  setGlobalCredentials(db, { username: 'admin1', password: 'panasonic' });
  ensureDefaultCredentials(db);
  assert.deepEqual(getGlobalCredentials(db), { username: 'admin1', password: 'panasonic' });
});
