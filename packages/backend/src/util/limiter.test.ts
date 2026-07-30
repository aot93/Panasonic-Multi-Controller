import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from './limiter.js';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test('createLimiter: never runs more than `concurrency` jobs at once', async () => {
  const limit = createLimiter(2);
  let active = 0;
  let maxActive = 0;
  const gates = Array.from({ length: 5 }, () => deferred<void>());

  const runs = gates.map((gate, i) =>
    limit(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active--;
      return i;
    }),
  );

  // Let the first batch actually start before releasing anything.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(maxActive, 2);

  for (const gate of gates) gate.resolve();
  const results = await Promise.all(runs);
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
  assert.equal(maxActive, 2);
});

test('createLimiter: a rejected job does not stall the queue', async () => {
  const limit = createLimiter(1);
  const results: Array<'ok' | 'fail'> = [];

  await Promise.allSettled([
    limit(async () => {
      throw new Error('boom');
    }).catch(() => results.push('fail')),
    limit(async () => {
      results.push('ok');
    }),
  ]);

  assert.deepEqual(results, ['fail', 'ok']);
});

test('createLimiter: rejects construction with concurrency < 1', () => {
  assert.throws(() => createLimiter(0));
});
