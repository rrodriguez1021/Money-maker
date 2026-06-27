import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRules, deviceOf, evalRules } from '../src/routing.js';

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
const AND = 'Mozilla/5.0 (Linux; Android 14)';
const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

test('deviceOf classifies', () => {
  assert.equal(deviceOf(IOS), 'ios');
  assert.equal(deviceOf(AND), 'android');
  assert.equal(deviceOf(PC), 'other');
});

test('sanitizeRules: device needs at least one target, normalizes URLs', () => {
  const r = sanitizeRules({ type: 'device', ios: 'apps.apple.com/x', android: '', default: 'example.com' });
  assert.equal(r.ios, 'https://apps.apple.com/x');
  assert.equal(r.android, null);
  assert.equal(r.default, 'https://example.com/');
  assert.equal(sanitizeRules({ type: 'device' }), null);
  assert.equal(sanitizeRules({ type: 'device', ios: 'javascript:alert(1)' }), null);
});

test('sanitizeRules: split needs 2+ valid URLs (max 8)', () => {
  assert.equal(sanitizeRules({ type: 'split', urls: ['a.com'] }), null);
  const r = sanitizeRules({ type: 'split', urls: ['a.com', 'b.com', 'nope nope'] });
  assert.deepEqual(r.urls, ['https://a.com/', 'https://b.com/']);
});

test('evalRules: device routing picks per UA + variant, falls back to default', () => {
  const r = sanitizeRules({ type: 'device', ios: 'apps.apple.com/x', android: 'play.google.com/y', default: 'site.com' });
  assert.deepEqual(evalRules(r, { ua: IOS }), { dest: 'https://apps.apple.com/x', variant: 'ios' });
  assert.deepEqual(evalRules(r, { ua: AND }), { dest: 'https://play.google.com/y', variant: 'android' });
  assert.deepEqual(evalRules(r, { ua: PC }), { dest: 'https://site.com/', variant: 'other' });
});

test('evalRules: split rotates evenly by scan index with V-labels', () => {
  const r = sanitizeRules({ type: 'split', urls: ['a.com', 'b.com'] });
  assert.deepEqual(evalRules(r, { scanIndex: 0 }), { dest: 'https://a.com/', variant: 'V1' });
  assert.deepEqual(evalRules(r, { scanIndex: 1 }), { dest: 'https://b.com/', variant: 'V2' });
  assert.deepEqual(evalRules(r, { scanIndex: 2 }), { dest: 'https://a.com/', variant: 'V1' });
});

test('sanitizeRules: time needs valid windows; rejects bad times/order', () => {
  assert.equal(sanitizeRules({ type: 'time', windows: [{ start: '11:00', end: '10:00', url: 'a.com' }] }), null);
  const r = sanitizeRules({ type: 'time', tz: -300, windows: [
    { start: '11:00', end: '15:00', url: 'lunch.com', label: 'Lunch' },
    { start: '15:00', end: '22:00', url: 'dinner.com', label: 'Dinner' },
    { start: '25:00', end: '26:00', url: 'bad.com' },
  ], default: 'site.com' });
  assert.equal(r.windows.length, 2);
  assert.equal(r.tz, -300);
});

test('evalRules: time routing picks the active window (tz-aware), else default', () => {
  const r = sanitizeRules({ type: 'time', tz: 0, windows: [
    { start: '11:00', end: '15:00', url: 'lunch.com', label: 'Lunch' },
    { start: '15:00', end: '22:00', url: 'dinner.com', label: 'Dinner' },
  ], default: 'site.com' });
  const at = (h, m = 0) => Date.UTC(2026, 0, 1, h, m); // a UTC timestamp at hour h
  assert.deepEqual(evalRules(r, { now: at(12) }), { dest: 'https://lunch.com/', variant: 'Lunch' });
  assert.deepEqual(evalRules(r, { now: at(19) }), { dest: 'https://dinner.com/', variant: 'Dinner' });
  assert.deepEqual(evalRules(r, { now: at(8) }), { dest: 'https://site.com/', variant: 'default' });
  // tz offset shifts the active window: +60 min makes 10:30 UTC count as 11:30 local → Lunch.
  const r2 = sanitizeRules({ type: 'time', tz: 60, windows: [{ start: '11:00', end: '15:00', url: 'lunch.com' }] });
  assert.equal(evalRules(r2, { now: at(10, 30) }).dest, 'https://lunch.com/');
});
