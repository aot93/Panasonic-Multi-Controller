import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchDeviceName } from '@ppc/shared';

test('matchDeviceName: exact match', () => {
  assert.equal(matchDeviceName('Foyer', 'Foyer'), 'match');
});

test('matchDeviceName: case and whitespace differences are ignored', () => {
  assert.equal(matchDeviceName('Foyer', '  foyer  '), 'match');
  assert.equal(matchDeviceName('Main Stage', 'MAIN   STAGE'), 'match');
});

test('matchDeviceName: the name appearing within other slide text still matches (not a whole-string requirement)', () => {
  assert.equal(matchDeviceName('Main Stage', 'Room 204 - Main Stage - Building A'), 'match');
});

test('matchDeviceName: punctuation differences do not prevent a match', () => {
  assert.equal(matchDeviceName("Foyer's Projector", "FOYERS PROJECTOR"), 'match');
});

test('matchDeviceName: an unrelated read is a mismatch', () => {
  assert.equal(matchDeviceName('Main Stage', 'Conference Room B'), 'mismatch');
});

test('matchDeviceName: minor OCR character confusion (0/O, 1/l) is tolerated via the similarity fallback', () => {
  // "PR0JECT0R 1" (zeros for Os) should still be recognized as close to "Projector 1"
  assert.equal(matchDeviceName('Projector 1', 'PR0JECT0R 1'), 'match');
});

test('matchDeviceName: null or blank OCR text is an error, not a mismatch', () => {
  assert.equal(matchDeviceName('Foyer', null), 'error');
  assert.equal(matchDeviceName('Foyer', ''), 'error');
  assert.equal(matchDeviceName('Foyer', '   '), 'error');
});

test('matchDeviceName: a lower similarity threshold accepts a noisier read the default would reject', () => {
  const noisy = 'Praj3ct0r S3v3n';
  assert.equal(matchDeviceName('Projector Seven', noisy), 'mismatch'); // default threshold rejects it
  assert.equal(matchDeviceName('Projector Seven', noisy, { similarityThreshold: 0.5 }), 'match');
});

test('matchDeviceName: a stricter threshold rejects what the default would accept', () => {
  const status = matchDeviceName('Projector 1', 'PR0JECT0R 1', { similarityThreshold: 0.999 });
  assert.equal(status, 'mismatch');
});

test('matchDeviceName: an auto-numbered name is not confused with its neighbor (e.g. "Projector 1" vs a clean read of "Projector 2")', () => {
  // Found via a real OCR smoke test against sample-slides/Projector 2.png:
  // a single-digit substitution scores the same similarity as OCR mistaking
  // 0 for O, so plain fuzzy matching alone would wrongly accept this.
  assert.equal(matchDeviceName('Projector 1', 'bez-xps 02\n1280x1080\nProjector 2\n1920x1080\n'), 'mismatch');
});
