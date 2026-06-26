import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessScannability } from '../src/scan.js';

test('black on white is OK with high contrast', () => {
  const r = assessScannability({ colorDark: '#000000', colorBg: '#ffffff' });
  assert.equal(r.level, 'ok');
  assert.ok(r.contrast > 15);
});

test('near-equal colors are flagged as risk', () => {
  const r = assessScannability({ colorDark: '#eeeeee', colorBg: '#ffffff' });
  assert.equal(r.level, 'risk');
  assert.ok(r.messages.length);
});

test('low-but-not-terrible contrast warns', () => {
  const r = assessScannability({ colorDark: '#a0a0a0', colorBg: '#ffffff' });
  assert.equal(r.level, 'warn');
});

test('inverted (light on dark) warns', () => {
  const r = assessScannability({ colorDark: '#ffffff', colorBg: '#101018' });
  assert.ok(r.level !== 'ok');
  assert.ok(r.messages.some((m) => /light-on-dark/i.test(m)));
});

test('gradient uses the weaker endpoint for contrast', () => {
  // from is fine vs white, to is nearly white → should warn/risk on the weak end.
  const r = assessScannability({ colorBg: '#ffffff', gradient: { from: '#101030', to: '#f2f2f2' } });
  assert.ok(r.level !== 'ok');
});
