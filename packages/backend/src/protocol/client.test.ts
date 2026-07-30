import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendOnce, NtControlSession } from './client.js';
import { MockProjector } from './mock-server.js';
import { NtControlTimeoutError } from './types.js';

const CREDENTIALS = { username: 'admin1', password: 'panasonic' };

test('sendOnce: non-protect mode round trip', async () => {
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const result = await sendOnce({ host: '127.0.0.1', port }, 'QPW');
    assert.deepEqual(result, { ok: true, payload: '000' });
  } finally {
    await mock.close();
  }
});

test('sendOnce: MD5 protect mode with correct credentials', async () => {
  const mock = new MockProjector({ protectMode: 'md5' });
  const port = await mock.listen();
  try {
    const result = await sendOnce({ host: '127.0.0.1', port, credentials: CREDENTIALS }, 'QPW');
    assert.deepEqual(result, { ok: true, payload: '000' });
  } finally {
    await mock.close();
  }
});

test('sendOnce: SHA-256 protect mode with correct credentials', async () => {
  const mock = new MockProjector({ protectMode: 'sha256' });
  const port = await mock.listen();
  try {
    const result = await sendOnce({ host: '127.0.0.1', port, credentials: CREDENTIALS }, 'QPW');
    assert.deepEqual(result, { ok: true, payload: '000' });
  } finally {
    await mock.close();
  }
});

test('sendOnce: wrong password yields ERRA, not an exception', async () => {
  const mock = new MockProjector({ protectMode: 'md5' });
  const port = await mock.listen();
  try {
    const result = await sendOnce(
      { host: '127.0.0.1', port, credentials: { username: 'admin1', password: 'WRONG' } },
      'QPW',
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'ERRA');
      assert.equal(result.lockoutSeconds, null);
    }
  } finally {
    await mock.close();
  }
});

test('sendOnce: three consecutive bad passwords trigger a lockout with a countdown', async () => {
  const mock = new MockProjector({ protectMode: 'md5', lockoutThreshold: 3, lockoutSeconds: 30 });
  const port = await mock.listen();
  const badCreds = { username: 'admin1', password: 'WRONG' };
  try {
    for (let i = 0; i < 2; i++) {
      const r = await sendOnce({ host: '127.0.0.1', port, credentials: badCreds }, 'QPW');
      assert.equal(r.ok, false);
    }
    const lockedOut = await sendOnce({ host: '127.0.0.1', port, credentials: badCreds }, 'QPW');
    assert.equal(lockedOut.ok, false);
    if (!lockedOut.ok) {
      assert.equal(lockedOut.code, 'ERRA');
      assert.equal(lockedOut.lockoutSeconds, 30);
    }

    // Even the correct password is refused while locked out.
    const stillLocked = await sendOnce({ host: '127.0.0.1', port, credentials: CREDENTIALS }, 'QPW');
    assert.equal(stillLocked.ok, false);
    if (!stillLocked.ok) assert.equal(stillLocked.code, 'ERRA');
  } finally {
    await mock.close();
  }
});

test('sendOnce: unknown command returns ERR1', async () => {
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  try {
    const result = await sendOnce({ host: '127.0.0.1', port }, 'ZZZZ');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'ERR1');
  } finally {
    await mock.close();
  }
});

test('sendOnce: PON/POF actually change state, confirmed by re-querying QPW', async () => {
  const mock = new MockProjector({ protectMode: 'none', initialState: { power: 'off' } });
  const port = await mock.listen();
  try {
    const before = await sendOnce({ host: '127.0.0.1', port }, 'QPW');
    assert.deepEqual(before, { ok: true, payload: '000' });

    await sendOnce({ host: '127.0.0.1', port }, 'PON');

    const after = await sendOnce({ host: '127.0.0.1', port }, 'QPW');
    assert.deepEqual(after, { ok: true, payload: '001' });
  } finally {
    await mock.close();
  }
});

test('sendOnce: temperature query parses as fixed-width value/max', async () => {
  const mock = new MockProjector({
    protectMode: 'none',
    initialState: { tempIntakeC: 42, tempIntakeMaxC: 80 },
  });
  const port = await mock.listen();
  try {
    const result = await sendOnce({ host: '127.0.0.1', port }, 'QTM:0');
    assert.deepEqual(result, { ok: true, payload: '0042/0080' });
  } finally {
    await mock.close();
  }
});

test('sendOnce: lamp hours query', async () => {
  const mock = new MockProjector({ protectMode: 'none', initialState: { lampHours: [4321] } });
  const port = await mock.listen();
  try {
    const result = await sendOnce({ host: '127.0.0.1', port }, 'Q$L:1');
    assert.deepEqual(result, { ok: true, payload: '4321' });
  } finally {
    await mock.close();
  }
});

test('sendOnce: key=value query (projector runtime)', async () => {
  const mock = new MockProjector({ protectMode: 'none', initialState: { runtimeHours: 7864320 } });
  const port = await mock.listen();
  try {
    const result = await sendOnce({ host: '127.0.0.1', port }, 'QVX:RTMS1');
    assert.deepEqual(result, { ok: true, payload: 'RTMS1=7864320' });
  } finally {
    await mock.close();
  }
});

test('sendOnce: connection refused surfaces as a protocol error, not a hang', async () => {
  // Nothing is listening on this port.
  const mock = new MockProjector({ protectMode: 'none' });
  const port = await mock.listen();
  await mock.close();

  await assert.rejects(() => sendOnce({ host: '127.0.0.1', port }, 'QPW'));
});

test('NtControlSession: multiple commands over one kept-alive connection', async () => {
  const mock = new MockProjector({ protectMode: 'md5', sessionProlongSec: 10 });
  const port = await mock.listen();
  try {
    const session = await NtControlSession.open({ host: '127.0.0.1', port, credentials: CREDENTIALS });
    try {
      const off = await session.send('QPW');
      assert.deepEqual(off, { ok: true, payload: '000' });
      await session.send('PON');
      const on = await session.send('QPW');
      assert.deepEqual(on, { ok: true, payload: '001' });
    } finally {
      session.close();
    }
  } finally {
    await mock.close();
  }
});

test('NtControlSession: command timeout rejects rather than hanging forever', async () => {
  // sessionProlongSec 0 means the mock closes the socket right after its
  // first response; a second send() on the same (now-closed) session should
  // fail fast rather than hang until commandTimeoutMs.
  const mock = new MockProjector({ protectMode: 'none', sessionProlongSec: 0 });
  const port = await mock.listen();
  try {
    const session = await NtControlSession.open({ host: '127.0.0.1', port, commandTimeoutMs: 500 });
    await session.send('QPW');
    await assert.rejects(() => session.send('QPW'), (err: unknown) => err instanceof Error);
    session.close();
  } finally {
    await mock.close();
  }
});

test('NtControlSession.open: timing out waiting for a banner throws NtControlTimeoutError', async () => {
  // A raw TCP listener that accepts the connection but never sends a banner.
  const net = await import('node:net');
  const server = net.createServer(() => {
    /* deliberately silent */
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    await assert.rejects(
      () => NtControlSession.open({ host: '127.0.0.1', port, connectTimeoutMs: 300 }),
      (err: unknown) => err instanceof NtControlTimeoutError,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
