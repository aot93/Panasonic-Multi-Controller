process.env.PPC_SECRET_KEY = 'ee'.repeat(32);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { startTestApp } from '../http/test-helpers.js';
import { Poller } from '../poller/poller.js';
import { projectRouter } from './routes.js';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  seed(db);
  return db;
}

async function setup() {
  const db = makeDb();
  const poller = new Poller(db, null);
  const app = await startTestApp((app) => app.use('/api/project', projectRouter(db, poller)));
  return { db, app };
}

test('POST /api/project/import accepts a formatVersion 1 file (macro steps with a bare commandKey)', async () => {
  const { app } = await setup();
  try {
    const legacyFile = {
      formatVersion: 1,
      exportedAt: '2026-09-24T18:11:31.209Z',
      appName: 'panasonic-multi-controller',
      devices: [
        { name: 'Foyer', host: '192.168.0.101', port: 1024, location: null, notes: null, pollIntervalSec: null, groupNames: ['Slot 1'] },
      ],
      groups: [{ name: 'Slot 1', description: null, sortOrder: 0 }],
      commands: [],
      macros: [
        {
          name: 'All Settings',
          description: 'all settings',
          colour: null,
          icon: null,
          sortOrder: 0,
          steps: [{ commandKey: 'aspect.set', param: '6', delayMsAfter: 200, target: null }],
        },
      ],
      schedules: [],
      triggers: [
        {
          triggerKey: 'hvfitall',
          description: null,
          enabled: true,
          target: { kind: 'all' },
          action: { kind: 'macro', macroName: 'All Settings' },
          param: null,
        },
      ],
    };

    const res = await fetch(`${app.baseUrl}/api/project/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(legacyFile),
    });
    const body = (await res.json()) as {
      devices: { created: number };
      macros: { created: number };
      triggers: { created: number };
      warnings: string[];
    };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.devices.created, 1);
    assert.equal(body.macros.created, 1);
    assert.equal(body.triggers.created, 1);
    assert.deepEqual(body.warnings, []);
  } finally {
    await app.close();
  }
});

test('POST /api/project/import rejects a file with an unrecognizable shape', async () => {
  const { app } = await setup();
  try {
    const res = await fetch(`${app.baseUrl}/api/project/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formatVersion: 99, appName: 'panasonic-multi-controller' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});
