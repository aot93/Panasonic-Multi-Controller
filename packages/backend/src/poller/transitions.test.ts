import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeHealthTransition } from './transitions.js';

test('no event when health does not change', () => {
  assert.equal(describeHealthTransition('Foyer', 'ok', 'ok', null), null);
});

test('becoming unreachable is always an error-severity event, even from warning', () => {
  const event = describeHealthTransition('Foyer', 'warning', 'unreachable', null);
  assert.equal(event?.severity, 'error');
  assert.equal(event?.code, 'comms.lost');
});

test('recovering from unreachable is an info event', () => {
  const event = describeHealthTransition('Foyer', 'unreachable', 'ok', null);
  assert.equal(event?.severity, 'info');
  assert.equal(event?.code, 'comms.restored');
});

test('a brand-new device (from "unknown") that is already unreachable still alerts', () => {
  const event = describeHealthTransition('Foyer', 'unknown', 'unreachable', null);
  assert.equal(event?.code, 'comms.lost');
});

test('crossing into warning', () => {
  const event = describeHealthTransition('Foyer', 'ok', 'warning', null);
  assert.equal(event?.severity, 'warning');
  assert.equal(event?.code, 'selfdiag.warning');
});

test('crossing into error is critical severity', () => {
  const event = describeHealthTransition('Foyer', 'warning', 'error', null);
  assert.equal(event?.severity, 'critical');
  assert.equal(event?.code, 'selfdiag.error');
});

test('recovering from warning or error to ok is an info event', () => {
  assert.equal(describeHealthTransition('Foyer', 'warning', 'ok', null)?.code, 'selfdiag.normal');
  assert.equal(describeHealthTransition('Foyer', 'error', 'ok', null)?.code, 'selfdiag.normal');
});

test('device name is interpolated into the message', () => {
  const event = describeHealthTransition('Lobby Left', 'ok', 'unreachable', null);
  assert.match(event!.message, /Lobby Left/);
});

test('a cause is included in the message when known', () => {
  const event = describeHealthTransition('Foyer', 'ok', 'error', 'U300: Intake air temperature error');
  assert.match(event!.message, /U300: Intake air temperature error/);
});

test('falls back to a generic message when no cause is identified', () => {
  const event = describeHealthTransition('Foyer', 'ok', 'warning', null);
  assert.match(event!.message, /warning/i);
});
