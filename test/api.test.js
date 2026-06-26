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

test('billing capability flags and checkout wiring (demo mode)', async () => {
  const { token } = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'billing@example.com' }),
  }).then(j);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const me = await fetch(`${base}/api/me`, { headers: H }).then(j);
  assert.equal(me.billingEnabled, false);
  assert.equal(me.businessBillingEnabled, false);
  assert.equal(me.annualBillingEnabled, false);

  // The route must accept plan + period without erroring; in demo mode it returns 503.
  const res = await fetch(`${base}/api/billing/checkout`, {
    method: 'POST', headers: H, body: JSON.stringify({ plan: 'business', period: 'annual' }),
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'billing_disabled');
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

test('hosted page link renders HTML instead of redirecting, and logs the scan', async () => {
  const { token } = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'page@example.com' }),
  }).then(j);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const link = await fetch(`${base}/api/links`, {
    method: 'POST', headers: H, body: JSON.stringify({
      title: 'Joe', page: { headline: 'Joe\'s Coffee', subtitle: 'Order & reviews',
        buttons: [{ label: 'Menu', url: 'example.com/menu' }] },
    }),
  }).then(j);
  assert.ok(link.page_json, 'page content stored');
  assert.equal(link.target, '#page');

  // Visiting the QR target serves HTML (not a redirect) and records a scan.
  const res = await fetch(`${base}/r/${link.id}`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /Joe&#39;s Coffee/);
  assert.match(html, /https:\/\/example\.com\/menu/);

  const { links } = await fetch(`${base}/api/links?token=${token}`).then(j);
  assert.equal(links[0].scans, 1);
});

test('hosted page can be edited and converted back to a redirect', async () => {
  const { token } = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pageedit@example.com' }),
  }).then(j);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const link = await fetch(`${base}/api/links`, {
    method: 'POST', headers: H, body: JSON.stringify({ page: { headline: 'V1', buttons: [{ label: 'A', url: 'example.com/a' }] } }),
  }).then(j);

  // Edit the page content.
  await fetch(`${base}/api/links/${link.id}`, {
    method: 'PUT', headers: H, body: JSON.stringify({ page: { headline: 'V2', subtitle: 'updated', buttons: [{ label: 'B', url: 'example.com/b' }] } }),
  }).then(j);
  let html = await fetch(`${base}/r/${link.id}`).then((r) => r.text());
  assert.match(html, /V2/);
  assert.match(html, /example\.com\/b/);
  assert.doesNotMatch(html, /V1/);

  // Convert it back to a plain redirect.
  await fetch(`${base}/api/links/${link.id}`, {
    method: 'PUT', headers: H, body: JSON.stringify({ page: null, target: 'example.com/final' }),
  }).then(j);
  const red = await fetch(`${base}/r/${link.id}`, { redirect: 'manual' });
  assert.equal(red.status, 302);
  assert.equal(red.headers.get('location'), 'https://example.com/final');

  // Editing only the title of a redirect link leaves its target intact.
  await fetch(`${base}/api/links/${link.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ title: 'renamed' }) }).then(j);
  const still = await fetch(`${base}/r/${link.id}`, { redirect: 'manual' });
  assert.equal(still.headers.get('location'), 'https://example.com/final');
});

test('bulk create respects plan cap and reports per-row results', async () => {
  const { token } = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bulk@example.com' }),
  }).then(j);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  // Free plan caps at 3: send 2 valid, 1 invalid, 2 more valid → 3 created, 2 skipped.
  const r = await fetch(`${base}/api/links/bulk`, {
    method: 'POST', headers: H, body: JSON.stringify({ items: [
      { target: 'example.com/1', title: 'One' }, { target: 'example.com/2' },
      { target: 'not a url' }, { target: 'example.com/3' }, { target: 'example.com/4' },
    ] }),
  }).then(j);
  assert.equal(r.createdCount, 3);
  assert.equal(r.skippedCount, 2);
  assert.ok(r.skipped.some((s) => s.reason === 'invalid_target'));
  assert.ok(r.skipped.some((s) => s.reason === 'limit_reached'));
});

test('CSV export: links summary and gated scan export', async () => {
  const biz = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'csv@example.com' }),
  }).then(j);
  setPlan(findAccountByToken(biz.token).id, 'pro');
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${biz.token}` };
  const link = await fetch(`${base}/api/links`, { method: 'POST', headers: H, body: JSON.stringify({ target: 'example.com/csv', title: 'CSV test' }) }).then(j);
  await fetch(`${base}/r/${link.id}`, { redirect: 'manual' }); // one scan

  const all = await fetch(`${base}/api/links/export.csv?token=${biz.token}`);
  assert.equal(all.headers.get('content-type'), 'text/csv; charset=utf-8');
  const body = await all.text();
  assert.match(body, /"id","title","destination","short_url","scans","status","created_at"/);
  assert.match(body, /CSV test/);

  const scans = await fetch(`${base}/api/links/${link.id}/stats.csv?token=${biz.token}`).then((r) => r.text());
  assert.match(scans, /"timestamp","referrer","user_agent"/);

  // Free plan blocked from scan CSV
  const free = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'csvfree@example.com' }),
  }).then(j);
  const FH = { Authorization: `Bearer ${free.token}` };
  const fl = await fetch(`${base}/api/links`, { method: 'POST', headers: { ...FH, 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'example.com/x' }) }).then(j);
  assert.equal((await fetch(`${base}/api/links/${fl.id}/stats.csv`, { headers: FH })).status, 402);
});

test('CSV export defuses spreadsheet formula injection', async () => {
  const acct = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'inject@example.com' }),
  }).then(j);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${acct.token}` };
  await fetch(`${base}/api/links`, { method: 'POST', headers: H, body: JSON.stringify({ target: 'example.com/y', title: '=SUM(A1:A9)' }) });
  const body = await fetch(`${base}/api/links/export.csv?token=${acct.token}`).then((r) => r.text());
  assert.match(body, /"'=SUM\(A1:A9\)"/, 'leading = is neutralized with a quote');
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
