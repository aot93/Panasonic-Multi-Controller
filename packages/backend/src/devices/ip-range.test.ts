import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIpRange } from './ip-range.js';
import { BadRequestError } from '../http/errors.js';

test('parseIpRange: expands an inclusive range within a /24', () => {
  assert.deepEqual(parseIpRange('192.168.1.10', '192.168.1.13'), [
    '192.168.1.10',
    '192.168.1.11',
    '192.168.1.12',
    '192.168.1.13',
  ]);
});

test('parseIpRange: a single-address range (start === end) returns one IP', () => {
  assert.deepEqual(parseIpRange('10.0.0.5', '10.0.0.5'), ['10.0.0.5']);
});

test('parseIpRange: rejects a malformed start IP', () => {
  assert.throws(() => parseIpRange('not-an-ip', '192.168.1.13'), BadRequestError);
});

test('parseIpRange: rejects an octet out of range', () => {
  assert.throws(() => parseIpRange('192.168.1.999', '192.168.1.13'), BadRequestError);
  assert.throws(() => parseIpRange('192.168.1.10', '192.168.1.-1'), BadRequestError);
});

test('parseIpRange: rejects a range spanning different /24s', () => {
  assert.throws(() => parseIpRange('192.168.1.10', '192.168.2.13'), BadRequestError);
});

test('parseIpRange: rejects start > end', () => {
  assert.throws(() => parseIpRange('192.168.1.20', '192.168.1.10'), BadRequestError);
});

test('parseIpRange: exactly 254 addresses (the max) is allowed', () => {
  const ips = parseIpRange('10.0.0.1', '10.0.0.254');
  assert.equal(ips.length, 254);
});

test('parseIpRange: 255 addresses within one /24 is rejected as too large', () => {
  // 10.0.0.0 through 10.0.0.254 inclusive = 255 addresses, one over the cap.
  assert.throws(() => parseIpRange('10.0.0.0', '10.0.0.254'), BadRequestError);
});
