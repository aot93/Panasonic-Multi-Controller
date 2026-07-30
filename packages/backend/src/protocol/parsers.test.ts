import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupSelfDiagnosisCode } from '@ppc/shared';
import { parseAcVoltage, parseDirectSelfDiagnosisCode, parsePositionalSelfDiagnosisField, parseShutter } from './parsers.js';

test('parseAcVoltage: whole volts, no scaling — confirmed against real hardware ("VMOI2=+00238" -> 238V)', () => {
  assert.equal(parseAcVoltage('VMOI2=+00238'), 238);
  assert.equal(parseAcVoltage('VMOI2=+00239'), 239);
  assert.equal(parseAcVoltage('VMOI2=+00000'), 0);
});

test('parseAcVoltage: a malformed value field returns NaN rather than throwing', () => {
  assert.ok(Number.isNaN(parseAcVoltage('VMOI2=')));
  assert.ok(Number.isNaN(parseAcVoltage('VMOI2=not-a-number')));
});

test('parseShutter: "1" is closed, "0" is open', () => {
  assert.equal(parseShutter('1'), true);
  assert.equal(parseShutter('0'), false);
});

test('parseDirectSelfDiagnosisCode: returns the literal code, confirmed against real hardware ("ERRS2=H001" -> "H001")', () => {
  assert.equal(parseDirectSelfDiagnosisCode('ERRS2=H001'), 'H001');
});

test('parseDirectSelfDiagnosisCode: blank, all-N, or all-zero is "nothing active"', () => {
  assert.equal(parseDirectSelfDiagnosisCode('ERRS2='), null);
  assert.equal(parseDirectSelfDiagnosisCode('ERRS2=N'), null);
  assert.equal(parseDirectSelfDiagnosisCode('ERRS2=NNNN'), null);
  assert.equal(parseDirectSelfDiagnosisCode('ERRS2=0000'), null);
});

test('parsePositionalSelfDiagnosisField: finds the active (non-N) position, confirmed against a real 511-char capture', () => {
  const raw = 'N'.repeat(151) + 'E' + 'N'.repeat(359); // 511 chars total, 'E' at 1-based position 152
  assert.equal(raw.length, 511);
  assert.deepEqual(parsePositionalSelfDiagnosisField(`ERRS1=${raw}`), [152]);
});

test('parsePositionalSelfDiagnosisField: all-N reports no active positions', () => {
  assert.deepEqual(parsePositionalSelfDiagnosisField('ERRS1=' + 'N'.repeat(20)), []);
});

test('parsePositionalSelfDiagnosisField: multiple active positions are all reported', () => {
  assert.deepEqual(parsePositionalSelfDiagnosisField('ERRS1=NENEN'), [2, 4]);
});

test('lookupSelfDiagnosisCode: exact codes from the hardware-confirmed table', () => {
  assert.deepEqual(lookupSelfDiagnosisCode('H001'), {
    code: 'H001',
    description: 'Battery replacement for the internal clock',
    severity: 'info',
    relatedSensors: [],
  });
  assert.deepEqual(lookupSelfDiagnosisCode('U081'), {
    code: 'U081',
    description: 'Low AC voltage warning (below 90 V)',
    severity: 'warning',
    relatedSensors: ['voltage'],
  });
});

test('lookupSelfDiagnosisCode: range entries match by numeric bounds within the same letter prefix', () => {
  assert.equal(lookupSelfDiagnosisCode('U230')?.description, 'Other high temperature warning');
  assert.equal(lookupSelfDiagnosisCode('F063')?.description, 'Light source driver communication error');
  assert.equal(lookupSelfDiagnosisCode('H020')?.description, 'Temperature sensor error');
});

test('lookupSelfDiagnosisCode: out-of-range or unknown-prefix codes return null', () => {
  assert.equal(lookupSelfDiagnosisCode('U999'), null);
  assert.equal(lookupSelfDiagnosisCode('Z001'), null);
});

test('lookupSelfDiagnosisCode: case-insensitive', () => {
  assert.equal(lookupSelfDiagnosisCode('h001')?.code, 'H001');
});
