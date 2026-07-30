import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockProjector } from '../protocol/mock-server.js';
import { pollDevice } from './poll-device.js';

const CREDENTIALS = { username: 'admin1', password: 'panasonic' };

test('pollDevice: full successful poll populates every field', async () => {
  const mock = new MockProjector({
    protectMode: 'none',
    initialState: {
      power: 'on',
      tempIntakeC: 32,
      tempIntakeMaxC: 80,
      tempExhaustC: 36,
      tempExhaustMaxC: 80,
      aspect: 6,
      screenSetting: 1,
      lampHours: [1234, 5678],
      input: 'DL1:PC1',
      shutterClosed: true,
      acVoltageRaw: 238,
    },
  });
  const port = await mock.listen();
  try {
    const reading = await pollDevice({ host: '127.0.0.1', port, credentials: null, lampCount: 2 });
    assert.equal(reading.ok, true);
    assert.equal(reading.error, null);
    assert.equal(reading.power, 'on');
    assert.equal(reading.tempIntakeC, 32);
    assert.equal(reading.tempIntakeMaxC, 80);
    assert.equal(reading.tempExhaustC, 36);
    assert.equal(reading.aspect, '6');
    assert.equal(reading.screenSetting, '1');
    assert.equal(reading.input, 'DL1:PC1');
    assert.equal(reading.shutter, true);
    assert.equal(reading.acVoltageV, 238);
    assert.deepEqual(reading.selfDiagnosis, []);
    assert.deepEqual(reading.lampHours, [1234, 5678]);
    assert.ok(reading.latencyMs >= 0);
  } finally {
    await mock.close();
  }
});

test('pollDevice: unreachable host reports ok:false with a connection error, not a throw', async () => {
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  await mock.close(); // nothing listening now

  const reading = await pollDevice({ host: '127.0.0.1', port, credentials: null, lampCount: 1 });
  assert.equal(reading.ok, false);
  assert.equal(reading.power, 'unknown');
  assert.ok(reading.error);
});

test('pollDevice: wrong credentials report ok:false with the device\'s own rejection message', async () => {
  const mock = new MockProjector({ protectMode: 'md5' });
  const port = await mock.listen();
  try {
    const reading = await pollDevice({
      host: '127.0.0.1',
      port,
      credentials: { username: 'admin1', password: 'WRONG' },
      lampCount: 1,
    });
    assert.equal(reading.ok, false);
    assert.equal(reading.power, 'unknown');
    assert.equal(reading.tempIntakeC, null);
    assert.match(reading.error ?? '', /password/i);
  } finally {
    await mock.close();
  }
});

test('pollDevice: correct credentials in protect mode succeed', async () => {
  const mock = new MockProjector({ protectMode: 'md5', initialState: { power: 'off' } });
  const port = await mock.listen();
  try {
    const reading = await pollDevice({ host: '127.0.0.1', port, credentials: CREDENTIALS, lampCount: 1 });
    assert.equal(reading.ok, true);
    assert.equal(reading.power, 'off');
  } finally {
    await mock.close();
  }
});

test('pollDevice: a lamp index the device does not have is simply omitted, not fatal', async () => {
  const mock = new MockProjector({ protectMode: 'none', initialState: { lampHours: [1000] } });
  const port = await mock.listen();
  try {
    // Ask for 3 lamps when the mock only has 1 configured.
    const reading = await pollDevice({ host: '127.0.0.1', port, credentials: null, lampCount: 3 });
    assert.equal(reading.ok, true);
    assert.deepEqual(reading.lampHours, [1000]);
  } finally {
    await mock.close();
  }
});

test('pollDevice: a malformed AC voltage response is dropped, not stored as NaN', async () => {
  const mock = new MockProjector({ protectMode: 'none', initialState: { acVoltageMalformed: true } });
  const port = await mock.listen();
  try {
    const reading = await pollDevice({ host: '127.0.0.1', port, credentials: null, lampCount: 1 });
    assert.equal(reading.ok, true);
    assert.equal(reading.acVoltageV, null);
  } finally {
    await mock.close();
  }
});

test('pollDevice: ERRS2 returning a known code (e.g. from real hardware) is decoded', async () => {
  const mock = new MockProjector({ protectMode: 'none', initialState: { errs2: 'H001' } });
  const port = await mock.listen();
  try {
    const reading = await pollDevice({ host: '127.0.0.1', port, credentials: null, lampCount: 1 });
    assert.equal(reading.selfDiagnosis.length, 1);
    assert.equal(reading.selfDiagnosis[0]?.code, 'H001');
    assert.equal(reading.selfDiagnosis[0]?.severity, 'info');
    assert.equal(reading.selfDiagnosis[0]?.source, 'ERRS2');
  } finally {
    await mock.close();
  }
});

test('pollDevice: ERRS2 returning an unrecognized code is still surfaced, not dropped', async () => {
  const mock = new MockProjector({ protectMode: 'none', initialState: { errs2: 'Z999' } });
  const port = await mock.listen();
  try {
    const reading = await pollDevice({ host: '127.0.0.1', port, credentials: null, lampCount: 1 });
    assert.equal(reading.selfDiagnosis.length, 1);
    assert.equal(reading.selfDiagnosis[0]?.code, 'Z999');
    assert.match(reading.selfDiagnosis[0]?.description ?? '', /Unrecognized/);
  } finally {
    await mock.close();
  }
});

test('pollDevice: ERRS1 with an active position is reported as unidentified, not silently dropped', async () => {
  // 'N' x5 with the 3rd position active — mirrors the real capture's shape (all 'N' except one position).
  const mock = new MockProjector({ protectMode: 'none', initialState: { errs1: 'NNENN' } });
  const port = await mock.listen();
  try {
    const reading = await pollDevice({ host: '127.0.0.1', port, credentials: null, lampCount: 1 });
    const finding = reading.selfDiagnosis.find((f) => f.source === 'ERRS1');
    assert.ok(finding);
    assert.equal(finding?.code, null);
    assert.equal(finding?.position, 3);
    assert.equal(finding?.severity, 'warning');
  } finally {
    await mock.close();
  }
});

test('pollDevice: an all-N ERRS1 and ERRS2 report no self-diagnosis findings', async () => {
  const mock = new MockProjector({ protectMode: 'none' }); // defaults: errs1 all 'N', errs2 'N'
  const port = await mock.listen();
  try {
    const reading = await pollDevice({ host: '127.0.0.1', port, credentials: null, lampCount: 1 });
    assert.deepEqual(reading.selfDiagnosis, []);
  } finally {
    await mock.close();
  }
});

test('pollDevice: lampCount 0 skips lamp queries entirely', async () => {
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const reading = await pollDevice({ host: '127.0.0.1', port, credentials: null, lampCount: 0 });
    assert.deepEqual(reading.lampHours, []);
  } finally {
    await mock.close();
  }
});
