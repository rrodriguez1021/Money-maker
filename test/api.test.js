// End-to-end smoke test of the DynaQR API. Runs against a real in-memory-ish DB
// (a temp file) and a live HTTP server. No external services required.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

function logoDataUrl() {
  const png = new PNG({ width: 32, height: 32 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 0; png.data[i + 1] = 128; png.data[i + 2] = 255; png.data[i + 3] = 255; }
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}

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

test('SSE stream pushes a live scan event to the link owner', async () => {
  const { token } = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sse@example.com' }),
  }).then(j);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const link = await fetch(`${base}/api/links`, { method: 'POST', headers: H, body: JSON.stringify({ target: 'example.com/sse' }) }).then(j);

  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events?token=${token}`, { signal: ctrl.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const dec = new TextDecoder();

  // We're connected now → trigger a scan, then read until the event arrives.
  await fetch(`${base}/r/${link.id}`, { redirect: 'manual' });
  let buf = '', got = false;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !got) {
    const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ value: undefined }), 400))]);
    if (chunk.value) buf += dec.decode(chunk.value, { stream: true });
    if (buf.includes('event: scan') && buf.includes(link.id)) got = true;
  }
  ctrl.abort();
  await reader.cancel().catch(() => {});
  assert.ok(got, 'received a scan event over SSE');
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
  // Buttons route through the click tracker; the click then redirects to the real URL.
  assert.match(html, new RegExp(`/r/${link.id}/b/0`));
  const click = await fetch(`${base}/r/${link.id}/b/0`, { redirect: 'manual' });
  assert.equal(click.headers.get('location'), 'https://example.com/menu');

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
  assert.doesNotMatch(html, /V1/);
  // The edited button now points (via the tracker) to example.com/b.
  const c = await fetch(`${base}/r/${link.id}/b/0`, { redirect: 'manual' });
  assert.equal(c.headers.get('location'), 'https://example.com/b');

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

test('hosted page button clicks are tracked and reported in stats (Pro)', async () => {
  const { token } = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'clicks@example.com' }),
  }).then(j);
  setPlan(findAccountByToken(token).id, 'pro');
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const link = await fetch(`${base}/api/links`, {
    method: 'POST', headers: H, body: JSON.stringify({ page: { headline: 'Joe', buttons: [
      { label: 'Menu', url: 'example.com/menu' }, { label: 'Call', url: 'tel:+15551234567' },
    ] } }),
  }).then(j);

  // The rendered page routes buttons through the click tracker.
  const html = await fetch(`${base}/r/${link.id}`).then((r) => r.text());
  assert.match(html, new RegExp(`/r/${link.id}/b/0`));

  // Click button 0 twice, button 1 once → redirects to the real URLs and logs clicks.
  const c0 = await fetch(`${base}/r/${link.id}/b/0`, { redirect: 'manual' });
  assert.equal(c0.status, 302);
  assert.equal(c0.headers.get('location'), 'https://example.com/menu');
  await fetch(`${base}/r/${link.id}/b/0`, { redirect: 'manual' });
  await fetch(`${base}/r/${link.id}/b/1`, { redirect: 'manual' });

  const stats = await fetch(`${base}/api/links/${link.id}/stats`, { headers: H }).then(j);
  const byLabel = Object.fromEntries(stats.buttonClicks.map((b) => [b.label, b.clicks]));
  assert.equal(byLabel.Menu, 2);
  assert.equal(byLabel.Call, 1);

  // Out-of-range button index redirects home rather than erroring.
  const oob = await fetch(`${base}/r/${link.id}/b/9`, { redirect: 'manual' });
  assert.equal(oob.status, 302);
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

test('center logo is gated to Business, validated, and never leaked in list', async () => {
  // Free account: logo is ignored, list never exposes a logo data URL.
  const free = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'logofree@example.com' }),
  }).then(j);
  const FH = { 'Content-Type': 'application/json', Authorization: `Bearer ${free.token}` };
  const fl = await fetch(`${base}/api/links`, { method: 'POST', headers: FH, body: JSON.stringify({ target: 'example.com/a', logo: logoDataUrl() }) }).then(j);
  assert.equal(fl.hasLogo, false, 'free plan cannot set a logo');
  assert.equal(fl.logo, undefined, 'logo data URL never returned');

  // Business account: logo accepted; QR renders; list reports hasLogo but not the data.
  const biz = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'logobiz@example.com' }),
  }).then(j);
  setPlan(findAccountByToken(biz.token).id, 'business');
  const BH = { 'Content-Type': 'application/json', Authorization: `Bearer ${biz.token}` };
  const bl = await fetch(`${base}/api/links`, { method: 'POST', headers: BH, body: JSON.stringify({ target: 'example.com/b', logo: logoDataUrl() }) }).then(j);
  assert.equal(bl.hasLogo, true);
  assert.equal(bl.logo, undefined);

  const png = await fetch(`${base}/api/links/${bl.id}/qr.png?token=${biz.token}`);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.ok(Number(png.headers.get('content-length')) > 100);
  const svg = await fetch(`${base}/api/links/${bl.id}/qr.svg?token=${biz.token}`).then((r) => r.text());
  assert.match(svg, /<image[^>]+href="data:image\/png/);

  const { links } = await fetch(`${base}/api/links?token=${biz.token}`).then(j);
  assert.ok(links.every((l) => l.logo === undefined), 'list never includes logo bytes');

  // Invalid logo is rejected with 400.
  const bad = await fetch(`${base}/api/links`, { method: 'POST', headers: BH, body: JSON.stringify({ target: 'example.com/c', logo: 'data:image/png;base64,zzzz' }) });
  assert.equal(bad.status, 400);

  // Logo can be cleared via PUT with logo:null.
  await fetch(`${base}/api/links/${bl.id}`, { method: 'PUT', headers: BH, body: JSON.stringify({ logo: null }) }).then(j);
  const after = await fetch(`${base}/api/links?token=${biz.token}`).then((r) => r.json());
  assert.equal(after.links.find((l) => l.id === bl.id).hasLogo, false);
});

test('API keys: create, authenticate a call, list masked, revoke', async () => {
  const { token } = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'apikeys@example.com' }),
  }).then(j);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Create a key — full secret returned exactly once.
  const made = await fetch(`${base}/api/keys`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'POS' }) }).then(j);
  assert.match(made.key, /^dqr_live_/);

  // The key authenticates an API call.
  const KH = { 'Content-Type': 'application/json', Authorization: `Bearer ${made.key}` };
  const link = await fetch(`${base}/api/links`, { method: 'POST', headers: KH, body: JSON.stringify({ target: 'example.com/via-key' }) });
  assert.equal(link.status, 201);

  // Listing never exposes the raw secret — only a prefix.
  const { keys } = await fetch(`${base}/api/keys`, { headers: H }).then(j);
  assert.equal(keys.length, 1);
  assert.ok(!('key_hash' in keys[0]), 'hash not exposed');
  assert.ok(keys[0].prefix.startsWith('dqr_live_'));
  assert.ok(!keys.some((k) => k.prefix.length > 30), 'only a prefix is shown');

  // Revoke → the key stops working.
  await fetch(`${base}/api/keys/${keys[0].id}`, { method: 'DELETE', headers: H }).then(j);
  const after = await fetch(`${base}/api/links`, { headers: { Authorization: `Bearer ${made.key}` } });
  assert.equal(after.status, 401, 'revoked key rejected');
});

test('referrals: signup attribution, count, and page footer carries the code', async () => {
  // Referrer signs up and gets a referral link.
  const ref = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'referrer@example.com' }),
  }).then(j);
  const RH = { 'Content-Type': 'application/json', Authorization: `Bearer ${ref.token}` };
  const info = await fetch(`${base}/api/referrals`, { headers: RH }).then(j);
  assert.ok(info.code && info.link.includes(`ref=${info.code}`));
  assert.equal(info.count, 0);

  // A new user signs up carrying that ref code → attributed.
  await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invited@example.com', ref: info.code }),
  }).then(j);
  const after = await fetch(`${base}/api/referrals`, { headers: RH }).then(j);
  assert.equal(after.count, 1, 'referral attributed');

  // A hosted page owned by the referrer links its footer back with the ref code.
  const link = await fetch(`${base}/api/links`, {
    method: 'POST', headers: RH, body: JSON.stringify({ page: { headline: 'Hi', buttons: [{ label: 'X', url: 'example.com' }] } }),
  }).then(j);
  const html = await fetch(`${base}/r/${link.id}`).then((r) => r.text());
  assert.match(html, new RegExp(`ref=${info.code}`));
});

test('QR preview endpoint renders PNG and gates branding to plan', async () => {
  // Free plan: preview works but ignores logo/colors (still a valid PNG).
  const free = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'prev@example.com' }),
  }).then(j);
  const FH = { 'Content-Type': 'application/json', Authorization: `Bearer ${free.token}` };
  const r1 = await fetch(`${base}/api/qr/preview`, { method: 'POST', headers: FH, body: JSON.stringify({ text: 'https://x.com', logo: logoDataUrl(), logoShape: 'circle' }) });
  assert.equal(r1.headers.get('content-type'), 'image/png');
  assert.ok(Number(r1.headers.get('content-length')) > 100);

  // Business plan: preview with circular logo also renders.
  const biz = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'prevbiz@example.com' }),
  }).then(j);
  setPlan(findAccountByToken(biz.token).id, 'business');
  const BH = { 'Content-Type': 'application/json', Authorization: `Bearer ${biz.token}` };
  const r2 = await fetch(`${base}/api/qr/preview`, { method: 'POST', headers: BH, body: JSON.stringify({ text: 'https://x.com', colorDark: '#112233', colorBg: '#ffeedd', logo: logoDataUrl(), logoShape: 'circle' }) });
  assert.equal(r2.headers.get('content-type'), 'image/png');

  // The saved link persists the chosen logo shape and renders.
  const link = await fetch(`${base}/api/links`, { method: 'POST', headers: BH, body: JSON.stringify({ target: 'example.com/circ', logo: logoDataUrl(), logoShape: 'circle' }) }).then(j);
  assert.equal(link.logo_shape, 'circle');
  const qr = await fetch(`${base}/api/links/${link.id}/qr.png?token=${biz.token}`);
  assert.equal(qr.headers.get('content-type'), 'image/png');
});

test('gradient style is gated to Business, persisted, and applied', async () => {
  // Free plan: style is ignored.
  const free = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'gradfree@example.com' }),
  }).then(j);
  const FH = { 'Content-Type': 'application/json', Authorization: `Bearer ${free.token}` };
  const fl = await fetch(`${base}/api/links`, { method: 'POST', headers: FH, body: JSON.stringify({ target: 'example.com/a', style: { gradient: { from: '#ff0000', to: '#0000ff' } } }) }).then(j);
  assert.equal(fl.qr_style, null, 'free plan cannot set a gradient');

  // Business: persisted + QR renders.
  const biz = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'gradbiz@example.com' }),
  }).then(j);
  setPlan(findAccountByToken(biz.token).id, 'business');
  const BH = { 'Content-Type': 'application/json', Authorization: `Bearer ${biz.token}` };
  const bl = await fetch(`${base}/api/links`, { method: 'POST', headers: BH, body: JSON.stringify({ target: 'example.com/b', style: { gradient: { from: '#7c8cff', to: '#22e0d0', type: 'radial' } } }) }).then(j);
  assert.ok(bl.qr_style && JSON.parse(bl.qr_style).gradient.type === 'radial');
  const svg = await fetch(`${base}/api/links/${bl.id}/qr.svg?token=${biz.token}`).then((r) => r.text());
  assert.match(svg, /radialGradient id="qg"/);

  // Invalid gradient hex → ignored (no style stored).
  const bad = await fetch(`${base}/api/links`, { method: 'POST', headers: BH, body: JSON.stringify({ target: 'example.com/c', style: { gradient: { from: 'red', to: '#0000ff' } } }) }).then(j);
  assert.equal(bad.qr_style, null);
});

test('QR export supports high-res size and a SCAN ME poster frame', async () => {
  const { token } = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'export@example.com' }),
  }).then(j);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const link = await fetch(`${base}/api/links`, { method: 'POST', headers: H, body: JSON.stringify({ target: 'example.com/p' }) }).then(j);

  // High-res PNG honors size (within clamp).
  const hd = await fetch(`${base}/api/links/${link.id}/qr.png?size=1024&token=${token}`);
  assert.equal(hd.headers.get('content-type'), 'image/png');
  assert.ok(Number(hd.headers.get('content-length')) > 1000);

  // Poster frame returns SVG containing the SCAN ME label and a nested QR svg.
  const poster = await fetch(`${base}/api/links/${link.id}/qr.svg?frame=scanme&token=${token}`).then((r) => r.text());
  assert.match(poster, /SCAN ME/);
  assert.ok((poster.match(/<svg/g) || []).length >= 2, 'nested QR svg inside the frame');
});

test('preview returns a scannability verdict in headers', async () => {
  const biz = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'scanhdr@example.com' }),
  }).then(j);
  setPlan(findAccountByToken(biz.token).id, 'business');
  const BH = { 'Content-Type': 'application/json', Authorization: `Bearer ${biz.token}` };

  const ok = await fetch(`${base}/api/qr/preview`, { method: 'POST', headers: BH, body: JSON.stringify({ text: 'https://x.com', colorDark: '#0b0d17', colorBg: '#ffffff' }) });
  assert.equal(ok.headers.get('X-Scan-Level'), 'ok');

  const risk = await fetch(`${base}/api/qr/preview`, { method: 'POST', headers: BH, body: JSON.stringify({ text: 'https://x.com', colorDark: '#f0f0f0', colorBg: '#ffffff' }) });
  assert.equal(risk.headers.get('X-Scan-Level'), 'risk');
  assert.ok(risk.headers.get('X-Scan-Msg'));
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
