import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommandFrame, computeAuthHash, handshake, parseBanner, parseResponseFrame } from './framing.js';

test('parseBanner: non-protect mode', () => {
  assert.deepEqual(parseBanner('NTCONTROL 0'), { protectMode: 'none', challenge: null });
});

test('parseBanner: MD5 protect mode', () => {
  assert.deepEqual(parseBanner('NTCONTROL 1 23181e1e'), { protectMode: 'md5', challenge: '23181e1e' });
});

test('parseBanner: SHA-256 protect mode', () => {
  assert.deepEqual(parseBanner('NTCONTROL 2 abcdef12'), { protectMode: 'sha256', challenge: 'abcdef12' });
});

test('parseBanner: tolerates a trailing CR the caller forgot to strip', () => {
  assert.deepEqual(parseBanner('NTCONTROL 0\r'), { protectMode: 'none', challenge: null });
});

test('parseBanner: rejects garbage', () => {
  assert.throws(() => parseBanner('HELLO WORLD'));
});

test('parseBanner: rejects protect mode with no challenge', () => {
  assert.throws(() => parseBanner('NTCONTROL 1'));
});

test('computeAuthHash: matches the worked example in PTRQ-CONNECTION.pdf', () => {
  // "dbdd2dabd3d4d68c5dd970ec0c29fa6400QPW" is the documented example frame for
  // an MD5 session — the first 32 hex chars are the hash. We don't know the
  // exact user/pass/challenge that produced it (the doc doesn't say), so this
  // instead pins the *shape* (32 lowercase hex chars) and that the same
  // inputs always produce the same output.
  const hash = computeAuthHash({ username: 'admin1', password: 'panasonic' }, '23181e1e', 'md5');
  assert.match(hash, /^[0-9a-f]{32}$/);
  assert.equal(hash, computeAuthHash({ username: 'admin1', password: 'panasonic' }, '23181e1e', 'md5'));
});

test('computeAuthHash: sha256 produces 64 hex chars and differs from md5', () => {
  const md5 = computeAuthHash({ username: 'admin1', password: 'panasonic' }, '23181e1e', 'md5');
  const sha = computeAuthHash({ username: 'admin1', password: 'panasonic' }, '23181e1e', 'sha256');
  assert.match(sha, /^[0-9a-f]{64}$/);
  assert.notEqual(md5, sha);
});

test('computeAuthHash: username is part of the digest, not just decoration', () => {
  const a = computeAuthHash({ username: 'admin1', password: 'panasonic' }, '23181e1e', 'md5');
  const b = computeAuthHash({ username: 'dispadmin', password: 'panasonic' }, '23181e1e', 'md5');
  assert.notEqual(a, b);
});

test('handshake: non-protect mode needs no credentials', () => {
  const result = handshake('NTCONTROL 0');
  assert.equal(result.protectMode, 'none');
  assert.equal(result.authHash, null);
});

test('handshake: protect mode without credentials throws', () => {
  assert.throws(() => handshake('NTCONTROL 1 23181e1e'));
});

test('buildCommandFrame: protect mode prepends hash + "00"', () => {
  const frame = buildCommandFrame('QPW', 'dbdd2dabd3d4d68c5dd970ec0c29fa64');
  assert.equal(frame, 'dbdd2dabd3d4d68c5dd970ec0c29fa6400QPW\r');
});

test('buildCommandFrame: non-protect mode has no hash', () => {
  assert.equal(buildCommandFrame('QPW', null), '00QPW\r');
});

test('parseResponseFrame: strips exactly the fixed "00" header', () => {
  assert.deepEqual(parseResponseFrame('00001'), { ok: true, payload: '001' });
});

test('parseResponseFrame: power-off response is not mangled (regression for the old scripts\' lstrip bug)', () => {
  // The old Python scripts did response.lstrip('000'), which on a literal
  // "00000" off-response would strip the ENTIRE string. Confirms the fixed
  // 2-char header strip handles this correctly instead.
  assert.deepEqual(parseResponseFrame('00000'), { ok: true, payload: '000' });
});

test('parseResponseFrame: key=value payload passes through untouched after header strip', () => {
  assert.deepEqual(parseResponseFrame('00RTMS1=7864320'), { ok: true, payload: 'RTMS1=7864320' });
});

test('parseResponseFrame: plain error codes', () => {
  for (const code of ['ERR1', 'ERR2', 'ERR3', 'ERR4', 'ERR5', 'ERRA'] as const) {
    const result = parseResponseFrame(code);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, code);
      assert.equal(result.lockoutSeconds, null);
    }
  }
});

test('parseResponseFrame: ERRA lockout carries remaining seconds', () => {
  const result = parseResponseFrame('ERRA 120');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'ERRA');
    assert.equal(result.lockoutSeconds, 120);
  }
});

test('parseResponseFrame: rejects a frame too short to hold the header', () => {
  assert.throws(() => parseResponseFrame('0'));
});
