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

test('evalRules: device routing picks per UA, falls back to default', () => {
  const r = sanitizeRules({ type: 'device', ios: 'apps.apple.com/x', android: 'play.google.com/y', default: 'site.com' });
  assert.equal(evalRules(r, IOS), 'https://apps.apple.com/x');
  assert.equal(evalRules(r, AND), 'https://play.google.com/y');
  assert.equal(evalRules(r, PC), 'https://site.com/');
});

test('evalRules: split rotates evenly by scan index', () => {
  const r = sanitizeRules({ type: 'split', urls: ['a.com', 'b.com'] });
  assert.equal(evalRules(r, PC, 0), 'https://a.com/');
  assert.equal(evalRules(r, PC, 1), 'https://b.com/');
  assert.equal(evalRules(r, PC, 2), 'https://a.com/');
});
