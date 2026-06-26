// End-to-end smoke test of the DynaQR API. Runs against a real in-memory-ish DB
// (a temp file) and a live HTTP server. No external services required.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dynaqr-'));
process.env.DB_PATH = join(dir, 'test.db');

const { app } = await import('../src/server.js');
const { setPlan, findAccountByToken } = await import('../src/db.js');
let server, base;

before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const j = (res) => res.json();

test('signup issues a token', async () => {
  const r = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@example.com' }),
  }).then(j);
  assert.ok(r.token, 'token returned');
  assert.equal(r.plan, 'free');
});

test('rejects invalid email', async () => {
  const res = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nope' }),
  });
  assert.equal(res.status, 400);
});

test('full link lifecycle: create, redirect+scan, edit, stats gating', async () => {
  const { token } = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'lifecycle@example.com' }),
  }).then(j);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // create
  const link = await fetch(`${base}/api/links`, {
    method: 'POST', headers: H, body: JSON.stringify({ target: 'example.com/first', title: 'Menu' }),
  }).then(j);
  assert.ok(link.id);
  assert.equal(link.target, 'https://example.com/first');

  // scan via redirect (manual: don't follow)
  const redirect = await fetch(`${base}/r/${link.id}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.com/first');

  // edit destination — the printed QR now points elsewhere
  await fetch(`${base}/api/links/${link.id}`, {
    method: 'PUT', headers: H, body: JSON.stringify({ target: 'example.com/updated' }),
  }).then(j);
  const after = await fetch(`${base}/r/${link.id}`, { redirect: 'manual' });
  assert.equal(after.headers.get('location'), 'https://example.com/updated');

  // QR png renders
  const qr = await fetch(`${base}/api/links/${link.id}/qr.png?token=${token}`);
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.ok(Number(qr.headers.get('content-length')) > 100);

  // analytics is gated for free plan
  const stats = await fetch(`${base}/api/links/${link.id}/stats`, { headers: H });
  assert.equal(stats.status, 402, 'free plan blocked from analytics');

  // scans counted on the link list
  const { links } = await fetch(`${base}/api/links?token=${token}`).then(j);
  assert.equal(links[0].scans, 2);
});

test('free plan enforces the 3-code limit', async () => {
  const { token } = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'limit@example.com' }),
  }).then(j);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${base}/api/links`, { method: 'POST', headers: H, body: JSON.stringify({ target: `example.com/${i}` }) });
    assert.equal(r.status, 201);
  }
  const blocked = await fetch(`${base}/api/links`, { method: 'POST', headers: H, body: JSON.stringify({ target: 'example.com/4' }) });
  assert.equal(blocked.status, 402);
  assert.equal((await blocked.json()).error, 'limit_reached');
});

test('unauthorized without token', async () => {
  const res = await fetch(`${base}/api/links`);
  assert.equal(res.status, 401);
});

test('branded QR colors are gated to the Business plan', async () => {
  // Free account: colors are ignored and stored as null.
  const free = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'brandfree@example.com' }),
  }).then(j);
  const FH = { 'Content-Type': 'application/json', Authorization: `Bearer ${free.token}` };
  const freeLink = await fetch(`${base}/api/links`, {
    method: 'POST', headers: FH, body: JSON.stringify({ target: 'example.com/a', colorDark: '#ff0000', colorBg: '#0000ff' }),
  }).then(j);
  assert.equal(freeLink.color_dark, null, 'free plan cannot set brand color');

  // Business account: colors persist and the QR renders.
  const biz = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'brandbiz@example.com' }),
  }).then(j);
  setPlan(findAccountByToken(biz.token).id, 'business');
  const BH = { 'Content-Type': 'application/json', Authorization: `Bearer ${biz.token}` };
  const bizLink = await fetch(`${base}/api/links`, {
    method: 'POST', headers: BH, body: JSON.stringify({ target: 'example.com/b', colorDark: '#112233', colorBg: '#ffeedd' }),
  }).then(j);
  assert.equal(bizLink.color_dark, '#112233');
  assert.equal(bizLink.color_bg, '#ffeedd');

  // Invalid hex is rejected (stored null), not blindly trusted.
  const bad = await fetch(`${base}/api/links`, {
    method: 'POST', headers: BH, body: JSON.stringify({ target: 'example.com/c', colorDark: 'red; DROP TABLE' }),
  }).then(j);
  assert.equal(bad.color_dark, null, 'invalid hex rejected');

  const qr = await fetch(`${base}/api/links/${bizLink.id}/qr.png?token=${biz.token}`);
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.ok(Number(qr.headers.get('content-length')) > 100);

  // /api/me reflects branding entitlement
  const me = await fetch(`${base}/api/me`, { headers: BH }).then(j);
  assert.equal(me.plan, 'business');
  assert.equal(me.limits.branding, true);
});

test('account deletion erases account, links and scans (GDPR)', async () => {
  const { token } = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'erase@example.com' }),
  }).then(j);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const link = await fetch(`${base}/api/links`, { method: 'POST', headers: H, body: JSON.stringify({ target: 'example.com/x' }) }).then(j);
  await fetch(`${base}/r/${link.id}`, { redirect: 'manual' }); // generate a scan

  const del = await fetch(`${base}/api/account`, { method: 'DELETE', headers: H });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).deleted, true);

  // token is now invalid, and the link no longer resolves
  assert.equal((await fetch(`${base}/api/me`, { headers: H })).status, 401);
  assert.equal((await fetch(`${base}/r/${link.id}`, { redirect: 'manual' })).status, 404);
});
