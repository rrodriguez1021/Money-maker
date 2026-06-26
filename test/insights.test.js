import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceType, osName, browserName, referrerHost, summarizeScans } from '../src/insights.js';

test('deviceType classifies common agents', () => {
  assert.equal(deviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'Mobile');
  assert.equal(deviceType('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'Tablet');
  assert.equal(deviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Desktop');
  assert.equal(deviceType(''), 'Unknown');
});

test('osName and browserName', () => {
  assert.equal(osName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'iOS');
  assert.equal(osName('Mozilla/5.0 (Linux; Android 14)'), 'Android');
  assert.equal(osName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'macOS');
  assert.equal(browserName('Mozilla/5.0 ... Chrome/120.0 Safari/537.36'), 'Chrome');
  assert.equal(browserName('Mozilla/5.0 ... Version/17.0 Safari/605.1.15'), 'Safari');
  assert.equal(browserName('Mozilla/5.0 ... Edg/120.0'), 'Edge');
});

test('referrerHost strips www and handles direct', () => {
  assert.equal(referrerHost('https://www.instagram.com/p/abc'), 'instagram.com');
  assert.equal(referrerHost(null), 'Direct / scan');
  assert.equal(referrerHost('not a url'), 'Other');
});

test('summarizeScans aggregates and sorts by count', () => {
  const scans = [
    { user_agent: 'iPhone OS 17', referrer: 'https://instagram.com/x' },
    { user_agent: 'iPhone OS 17', referrer: 'https://instagram.com/y' },
    { user_agent: 'Windows NT 10.0; Chrome/120', referrer: null },
  ];
  const s = summarizeScans(scans);
  assert.equal(s.devices[0].name, 'Mobile');
  assert.equal(s.devices[0].scans, 2);
  assert.equal(s.referrers[0].name, 'instagram.com');
  assert.equal(s.referrers[0].scans, 2);
});
