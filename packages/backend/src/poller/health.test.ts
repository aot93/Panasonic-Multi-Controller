import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHealth } from './health.js';
import type { PollReading, SelfDiagnosisFinding } from './poll-device.js';

function finding(overrides: Partial<SelfDiagnosisFinding> = {}): SelfDiagnosisFinding {
  return {
    code: 'U201',
    description: 'Intake air temperature warning',
    severity: 'warning',
    relatedSensors: ['temperature'],
    source: 'ERRS2',
    ...overrides,
  };
}

function reading(overrides: Partial<PollReading> = {}): PollReading {
  return {
    ok: true,
    power: 'on',
    input: null,
    shutter: null,
    acVoltageV: null,
    selfDiagnosis: [],
    tempIntakeC: 30,
    tempIntakeMaxC: 80,
    tempExhaustC: 32,
    tempExhaustMaxC: 80,
    aspect: '6',
    screenSetting: '0',
    lampHours: [1000],
    latencyMs: 10,
    error: null,
    ...overrides,
  };
}

test('computeHealth: unreachable device is unreachable regardless of self-diagnosis findings', () => {
  assert.equal(computeHealth(reading({ ok: false, selfDiagnosis: [finding()] })), 'unreachable');
});

test('computeHealth: no active findings is ok', () => {
  assert.equal(computeHealth(reading({ selfDiagnosis: [] })), 'ok');
});

test('computeHealth: a warning-severity finding is warning', () => {
  assert.equal(computeHealth(reading({ selfDiagnosis: [finding({ severity: 'warning' })] })), 'warning');
});

test('computeHealth: an error-severity finding is error', () => {
  assert.equal(computeHealth(reading({ selfDiagnosis: [finding({ severity: 'error', code: 'U300' })] })), 'error');
});

test('computeHealth: error wins even when a warning finding is also active', () => {
  const findings = [finding({ severity: 'warning' }), finding({ severity: 'error', code: 'F011' })];
  assert.equal(computeHealth(reading({ selfDiagnosis: findings })), 'error');
});

test('computeHealth: an info-severity finding (e.g. a maintenance reminder) does not affect health', () => {
  const info = finding({ severity: 'info', code: 'H001', description: 'Battery replacement for the internal clock', relatedSensors: [] });
  assert.equal(computeHealth(reading({ selfDiagnosis: [info] })), 'ok');
});
