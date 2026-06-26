// Qrysm — dynamic QR code + link tracking SaaS.
//
// What makes it monetizable: a QR code printed on a flyer, menu, or product is
// permanent, but with Qrysm the *destination* behind it is editable forever and
// every scan is tracked. Free users get 3 codes; Pro (Stripe subscription) gets
// unlimited codes + scan analytics. That recurring upgrade is the revenue.

import express from 'express';
import { customAlphabet } from 'nanoid';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createAccount, findAccountByToken, findAccountByEmail, findAccountById,
  setPlan, setPlanForCustomer, planLimit,
  createLink, findLink, listLinks, countLinks, updateLink, deleteLink, setLinkPage, setLinkLogo,
  recordScan, countScans, recentScans, dailyScans, deleteAccount,
  createApiKey, listApiKeys, findApiKeyByHash, revokeApiKey, touchApiKey,
  findAccountByRefCode, setReferredBy, setRefCode, countReferrals, setLinkStyle,
  recordPageClick, clicksByButton,
} from './db.js';
import { createHash } from 'node:crypto';
import { sanitizePage, renderPage } from './page.js';
import { qrPng, qrSvg, qrMatrix, isValidLogo, frameSvg } from './qrlogo.js';
import {
  billingEnabled, businessBillingEnabled, annualBillingEnabled, createCheckoutSession,
  createPortalSession, constructEvent, customerIdFromEvent, planForSubscription,
} from './billing.js';
import { summarizeScans } from './insights.js';
import { assessScannability } from './scan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const app = express();

// URL-safe, unambiguous short codes (no look-alike chars).
const shortId = customAlphabet('346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz', 7);
const accountId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
const tokenId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 40);
const refId = customAlphabet('346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz', 8);
const now = () => Date.now();

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return process.env.PUBLIC_URL || `${proto}://${req.get('host')}`;
}

// --- Real-time scan stream (Server-Sent Events). accountId → set of live clients. ---
const sseClients = new Map();
function sseAdd(accountId, res) {
  if (!sseClients.has(accountId)) sseClients.set(accountId, new Set());
  sseClients.get(accountId).add(res);
}
function sseRemove(accountId, res) {
  const set = sseClients.get(accountId);
  if (set) { set.delete(res); if (!set.size) sseClients.delete(accountId); }
}
function emitScan(accountId, payload) {
  const set = sseClients.get(accountId);
  if (!set) return;
  const line = `event: scan\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) { try { res.write(line); } catch { /* dropped */ } }
}

// --- Stripe webhook must read the RAW body, so register it before json parser. ---
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const event = constructEvent(req.body, req.headers['stripe-signature']);
  if (!event) return res.status(400).send('invalid');

  (async () => {
    const customer = await customerIdFromEvent(event);
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const acct = findAccountById(s.client_reference_id);
      const plan = s.metadata?.plan === 'business' ? 'business' : 'pro';
      if (acct) setPlan(acct.id, plan, s.customer);
    } else if (event.type === 'customer.subscription.deleted') {
      if (customer) setPlanForCustomer(customer, 'free');
    } else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      if (customer) setPlanForCustomer(customer, sub.status === 'active' ? planForSubscription(sub) : 'free');
    }
  })().catch((e) => console.error('webhook handler error', e));

  res.json({ received: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Auth: lightweight token-based accounts. POST an email, get a token.
// For an MVP this is passwordless-by-token; swap in magic-link email in prod. ---
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  let account = findAccountByToken(token);
  // Also accept a programmatic API key (dqr_live_…). Stored hashed, so hash & look up.
  if (!account && typeof token === 'string' && token.startsWith('dqr_')) {
    const row = findApiKeyByHash(sha256(token));
    if (row) {
      account = findAccountById(row.account_id);
      if (account) touchApiKey(row.id, now());
    }
  }
  if (!account) return res.status(401).json({ error: 'unauthorized', hint: 'Pass a Bearer token from /api/signup or an API key.' });
  req.account = account;
  next();
}

app.post('/api/signup', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid_email' });
  const existing = findAccountByEmail(email);
  if (existing) return res.json({ token: existing.token, plan: existing.plan, returning: true });
  const acct = createAccount(accountId(), email, tokenId(), now(), refId());
  // Attribute the signup to a referrer if a valid ?ref code was passed through.
  const ref = String(req.body.ref || '').trim();
  if (ref) {
    const referrer = findAccountByRefCode(ref);
    if (referrer && referrer.id !== acct.id) setReferredBy(acct.id, referrer.id);
  }
  res.json({ token: acct.token, plan: acct.plan, returning: false });
});

app.get('/api/me', auth, (req, res) => {
  const limit = planLimit(req.account.plan);
  res.json({
    email: req.account.email,
    plan: req.account.plan,
    limits: {
      maxLinks: limit.maxLinks === Infinity ? null : limit.maxLinks,
      analytics: limit.analytics,
      branding: limit.branding,
    },
    used: countLinks(req.account.id),
    billingEnabled,
    businessBillingEnabled,
    annualBillingEnabled,
  });
});

// --- Links CRUD ---
app.get('/api/links', auth, (req, res) => {
  const links = listLinks(req.account.id).map((l) => ({
    ...stripLogo(l), active: !!l.active, scans: countScans(l.id), shortUrl: `${baseUrl(req)}/r/${l.id}`,
  }));
  res.json({ links });
});

// Export all of your links (with scan counts) as CSV — your own data, any plan.
app.get('/api/links/export.csv', auth, (req, res) => {
  const rows = listLinks(req.account.id).map((l) => [
    l.id, l.title, l.target, `${baseUrl(req)}/r/${l.id}`, countScans(l.id),
    l.active ? 'active' : 'inactive', new Date(l.created_at).toISOString(),
  ]);
  const csv = toCsv(['id', 'title', 'destination', 'short_url', 'scans', 'status', 'created_at'], rows);
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="dynaqr-links.csv"').send(csv);
});

app.post('/api/links', auth, (req, res) => {
  // A link is either a plain redirect (needs a valid target URL) or a hosted page.
  const page = sanitizePage(req.body.page, planLimit(req.account.plan).branding);
  let target;
  if (page) {
    target = '#page'; // hosted-page links don't redirect; /r/:id renders the page
  } else {
    target = normalizeUrl(req.body.target);
    if (!target) return res.status(400).json({ error: 'invalid_target', hint: 'Provide a valid http(s) URL, or a page.' });
  }
  const limit = planLimit(req.account.plan);
  if (countLinks(req.account.id) >= limit.maxLinks) {
    return res.status(402).json({ error: 'limit_reached', plan: req.account.plan, maxLinks: limit.maxLinks,
      hint: 'Upgrade to Pro for unlimited dynamic QR codes.' });
  }
  const title = String(req.body.title || '').slice(0, 120);
  const { colorDark, colorBg } = brandColors(req.body, req.account.plan);
  // Validate a center logo up front so we don't create a link then reject the logo.
  if (req.body.logo != null && planLimit(req.account.plan).branding && !isValidLogo(req.body.logo)) {
    return res.status(400).json({ error: 'invalid_logo', hint: 'Logo must be a PNG under 300KB.' });
  }
  const link = createLink(shortId(), req.account.id, title, target, now(), colorDark, colorBg);
  if (page) setLinkPage(link.id, req.account.id, JSON.stringify(page));
  if (req.body.logo && planLimit(req.account.plan).branding && isValidLogo(req.body.logo)) {
    setLinkLogo(link.id, req.account.id, req.body.logo, req.body.logoShape === 'circle' ? 'circle' : 'square');
  }
  const style = qrStyle(req.body, req.account.plan);
  if (style) setLinkStyle(link.id, req.account.id, JSON.stringify(style));
  res.status(201).json({ ...stripLogo(findLink(link.id)), active: !!link.active, shortUrl: `${baseUrl(req)}/r/${link.id}` });
});

// Bulk create — paste many destinations at once. Respects the plan's link cap and
// reports per-row results so a few bad URLs don't fail the whole batch.
app.post('/api/links/bulk', auth, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 100) : null;
  if (!items || !items.length) {
    return res.status(400).json({ error: 'no_items', hint: 'Provide items: [{ target, title? }] (max 100).' });
  }
  const limit = planLimit(req.account.plan);
  let remaining = limit.maxLinks === Infinity ? Infinity : limit.maxLinks - countLinks(req.account.id);
  const created = [], skipped = [];
  for (const it of items) {
    const target = normalizeUrl(it && it.target);
    if (!target) { skipped.push({ input: it && it.target, reason: 'invalid_target' }); continue; }
    if (remaining <= 0) { skipped.push({ input: it.target, reason: 'limit_reached' }); continue; }
    const title = String((it && it.title) || '').slice(0, 120);
    const { colorDark, colorBg } = brandColors(it, req.account.plan);
    const link = createLink(shortId(), req.account.id, title, target, now(), colorDark, colorBg);
    created.push({ id: link.id, title: link.title, target: link.target, shortUrl: `${baseUrl(req)}/r/${link.id}` });
    if (remaining !== Infinity) remaining--;
  }
  res.status(201).json({ created, skipped, createdCount: created.length, skippedCount: skipped.length });
});

app.put('/api/links/:id', auth, (req, res) => {
  const link = findLink(req.params.id);
  if (!link || link.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
  const title = req.body.title !== undefined ? String(req.body.title).slice(0, 120) : link.title;
  const active = req.body.active !== undefined ? !!req.body.active : !!link.active;
  // Preserve existing colors unless the request supplies new ones (and plan allows it).
  const hasColorFields = req.body.colorDark !== undefined || req.body.colorBg !== undefined;
  const { colorDark, colorBg } = hasColorFields
    ? brandColors(req.body, req.account.plan)
    : { colorDark: link.color_dark, colorBg: link.color_bg };

  // Resolve target + page together: a link is a hosted page or a redirect, not both.
  let target = link.target;
  let pageJson = link.page_json;
  if (req.body.page !== undefined && req.body.page !== null) {
    const page = sanitizePage(req.body.page, planLimit(req.account.plan).branding);
    if (!page) return res.status(400).json({ error: 'invalid_page', hint: 'Add a headline or at least one button.' });
    target = '#page'; pageJson = JSON.stringify(page);
  } else if (req.body.page === null || req.body.target !== undefined) {
    // Converting to (or staying) a redirect link — require a valid target URL.
    const t = normalizeUrl(req.body.target !== undefined ? req.body.target : link.target);
    if (!t) return res.status(400).json({ error: 'invalid_target' });
    target = t; pageJson = req.body.page === null ? null : pageJson;
  }

  // Logo: null clears it; a valid PNG sets it (Business only); invalid is rejected.
  if (req.body.logo !== undefined) {
    if (req.body.logo === null) {
      setLinkLogo(link.id, req.account.id, null, 'square');
    } else if (planLimit(req.account.plan).branding) {
      if (!isValidLogo(req.body.logo)) return res.status(400).json({ error: 'invalid_logo', hint: 'Logo must be a PNG under 300KB.' });
      setLinkLogo(link.id, req.account.id, req.body.logo, req.body.logoShape === 'circle' ? 'circle' : 'square');
    }
  }

  if (req.body.style !== undefined) {
    const style = qrStyle(req.body, req.account.plan);
    setLinkStyle(link.id, req.account.id, style ? JSON.stringify(style) : null);
  }

  updateLink(link.id, req.account.id, title, target, active, colorDark, colorBg);
  if (pageJson !== link.page_json) setLinkPage(link.id, req.account.id, pageJson);
  res.json({ ...stripLogo(findLink(link.id)), active });
});

app.delete('/api/links/:id', auth, (req, res) => {
  const link = findLink(req.params.id);
  if (!link || link.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
  deleteLink(link.id, req.account.id);
  res.json({ deleted: true });
});

// Duplicate a code (copies destination, title, colors, logo, style, page).
app.post('/api/links/:id/duplicate', auth, (req, res) => {
  const src = findLink(req.params.id);
  if (!src || src.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
  const limit = planLimit(req.account.plan);
  if (countLinks(req.account.id) >= limit.maxLinks) {
    return res.status(402).json({ error: 'limit_reached', hint: 'Upgrade to Pro for unlimited codes.' });
  }
  const id = shortId();
  const title = (src.title ? `${src.title} (copy)` : '').slice(0, 120);
  createLink(id, req.account.id, title, src.target, now(), src.color_dark, src.color_bg);
  if (src.page_json) setLinkPage(id, req.account.id, src.page_json);
  if (src.logo) setLinkLogo(id, req.account.id, src.logo, src.logo_shape || 'square');
  if (src.qr_style) setLinkStyle(id, req.account.id, src.qr_style);
  res.status(201).json({ ...stripLogo(findLink(id)), active: true, shortUrl: `${baseUrl(req)}/r/${id}` });
});

// --- Account deletion (GDPR right to erasure) ---
app.delete('/api/account', auth, (req, res) => {
  deleteAccount(req.account.id);
  res.json({ deleted: true });
});

// --- API keys: programmatic access. The full secret is shown once, then only hashed. ---
app.get('/api/keys', auth, (req, res) => {
  res.json({ keys: listApiKeys(req.account.id).map((k) => ({ ...k, revoked: !!k.revoked })) });
});

app.post('/api/keys', auth, (req, res) => {
  const name = String(req.body.name || '').slice(0, 60);
  const secret = 'dqr_live_' + tokenId();
  const prefix = secret.slice(0, 17) + '…';
  createApiKey(accountId(), req.account.id, name, sha256(secret), prefix, now());
  res.status(201).json({ key: secret, prefix, name, note: 'Store this secret now — it will not be shown again.' });
});

app.delete('/api/keys/:id', auth, (req, res) => {
  revokeApiKey(req.params.id, req.account.id);
  res.json({ revoked: true });
});

// --- Live scan stream for the dashboard radar. ---
app.get('/api/events', auth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('event: ready\ndata: {}\n\n');
  sseAdd(req.account.id, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ping); sseRemove(req.account.id, res); });
});

// --- Referrals: a shareable link + how many signups it has driven. ---
app.get('/api/referrals', auth, (req, res) => {
  let code = req.account.ref_code;
  if (!code) { code = refId(); setRefCode(req.account.id, code); } // backfill older accounts
  res.json({ code, link: `${baseUrl(req)}/?ref=${code}`, count: countReferrals(req.account.id) });
});

// --- QR image for a link (PNG or SVG). The QR encodes the stable short URL. ---
app.get('/api/links/:id/qr.:fmt', auth, async (req, res) => {
  const link = findLink(req.params.id);
  if (!link || link.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
  const url = `${baseUrl(req)}/r/${link.id}`;
  // Branded colors + center logo render only while the account has branding.
  const branding = planLimit(req.account.plan).branding;
  const size = Math.max(128, Math.min(2048, Number(req.query.size) || 512));
  const opts = { width: size };
  if (branding && (link.color_dark || link.color_bg)) {
    opts.color = { dark: link.color_dark || '#000000', light: link.color_bg || '#ffffff' };
  } else if (branding && link.page_json) {
    // A hosted page's QR defaults to the page's accent colour for brand cohesion.
    try { const pg = JSON.parse(link.page_json); if (pg.accent) opts.color = { dark: pg.accent, light: '#ffffff' }; } catch { /* ignore */ }
  }
  if (branding && link.logo) { opts.logo = link.logo; opts.logoShape = link.logo_shape || 'square'; }
  if (branding && link.qr_style) {
    try {
      const st = JSON.parse(link.qr_style);
      if (st.gradient) opts.gradient = st.gradient;
      if (st.module) opts.module = st.module;
      if (st.eye) opts.eye = st.eye;
    } catch { /* ignore */ }
  }
  try {
    if (req.params.fmt === 'svg') {
      let svg = await qrSvg(url, opts);
      if (req.query.frame === 'scanme') {
        svg = frameSvg(svg, { accent: (opts.color && opts.color.dark) || (opts.gradient && opts.gradient.to) || '#7c8cff', size });
      }
      res.type('image/svg+xml').send(svg);
    } else {
      res.type('image/png').send(await qrPng(url, opts));
    }
  } catch {
    res.status(500).json({ error: 'qr_failed' });
  }
});

// --- Live QR preview (no link saved). Reflects the caller's plan gating. ---
app.post('/api/qr/preview', auth, async (req, res) => {
  const branding = planLimit(req.account.plan).branding;
  const text = String(req.body.text || '').slice(0, 280) || 'https://qrysm.app/preview';
  const opts = { width: 320 };
  const { colorDark, colorBg } = brandColors(req.body, req.account.plan);
  if (colorDark || colorBg) opts.color = { dark: colorDark || '#000000', light: colorBg || '#ffffff' };
  if (branding && req.body.logo && isValidLogo(req.body.logo)) {
    opts.logo = req.body.logo;
    opts.logoShape = req.body.logoShape === 'circle' ? 'circle' : 'square';
  }
  const style = qrStyle(req.body, req.account.plan);
  if (style) {
    if (style.gradient) opts.gradient = style.gradient;
    if (style.module) opts.module = style.module;
    if (style.eye) opts.eye = style.eye;
  }
  // Scannability assessment surfaced via headers (the body is the PNG).
  const assess = assessScannability({ colorDark, colorBg, gradient: style && style.gradient, hasLogo: !!opts.logo, module: opts.module });
  res.set('X-Scan-Level', assess.level);
  res.set('X-Scan-Contrast', String(assess.contrast));
  if (assess.messages[0]) res.set('X-Scan-Msg', encodeURIComponent(assess.messages[0]));
  try {
    res.type('image/png').send(await qrPng(text, opts));
  } catch {
    res.status(500).json({ error: 'qr_failed' });
  }
});

// --- Analytics (Pro only) ---
app.get('/api/links/:id/stats', auth, (req, res) => {
  const link = findLink(req.params.id);
  if (!link || link.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
  if (!planLimit(req.account.plan).analytics) {
    return res.status(402).json({ error: 'upgrade_required', hint: 'Scan analytics is a Pro feature.' });
  }
  const since = now() - 30 * 86400000;
  // For hosted pages, map button-click counts to their labels.
  let buttonClicks = [];
  if (link.page_json) {
    try {
      const buttons = (JSON.parse(link.page_json).buttons) || [];
      const counts = Object.fromEntries(clicksByButton(link.id).map((c) => [c.btn, c.n]));
      buttonClicks = buttons.map((b, i) => ({ label: b.label, clicks: counts[i] || 0 }));
    } catch { /* ignore */ }
  }
  res.json({
    total: countScans(link.id),
    daily: dailyScans(link.id, since).map((d) => ({ date: new Date(d.day * 86400000).toISOString().slice(0, 10), scans: d.n })),
    recent: recentScans(link.id, 25).map((s) => ({ ts: s.ts, referrer: s.referrer, userAgent: s.user_agent })),
    buttonClicks,
    ...summarizeScans(recentScans(link.id, 1000000)),
  });
});

// Per-link scan export as CSV (Pro+ analytics feature).
app.get('/api/links/:id/stats.csv', auth, (req, res) => {
  const link = findLink(req.params.id);
  if (!link || link.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
  if (!planLimit(req.account.plan).analytics) {
    return res.status(402).json({ error: 'upgrade_required', hint: 'Scan analytics is a Pro feature.' });
  }
  const rows = recentScans(link.id, 1000000)
    .map((s) => [new Date(s.ts).toISOString(), s.referrer || '', s.user_agent || '']);
  const csv = toCsv(['timestamp', 'referrer', 'user_agent'], rows);
  res.type('text/csv').set('Content-Disposition', `attachment; filename="dynaqr-${link.id}-scans.csv"`).send(csv);
});

// --- Billing: start a checkout to upgrade to a paid plan (pro | business) ---
app.post('/api/billing/checkout', auth, async (req, res) => {
  if (!billingEnabled) return res.status(503).json({ error: 'billing_disabled', hint: 'Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID.' });
  const plan = req.body.plan === 'business' ? 'business' : 'pro';
  const period = req.body.period === 'annual' ? 'annual' : 'monthly';
  try {
    const session = await createCheckoutSession(req.account, baseUrl(req), plan, period);
    res.json({ url: session.url });
  } catch (e) {
    console.error('checkout error', e);
    res.status(500).json({ error: 'checkout_failed' });
  }
});

// --- Billing: open the Stripe customer portal to manage/cancel a subscription. ---
app.post('/api/billing/portal', auth, async (req, res) => {
  if (!billingEnabled) return res.status(503).json({ error: 'billing_disabled' });
  if (!req.account.stripe_customer) return res.status(400).json({ error: 'no_customer', hint: 'No subscription on this account yet.' });
  try {
    const session = await createPortalSession(req.account.stripe_customer, `${baseUrl(req)}/app`);
    res.json({ url: session.url });
  } catch (e) {
    console.error('portal error', e);
    res.status(500).json({ error: 'portal_failed' });
  }
});

// Hosted-page button click → log it, then redirect to the button's destination.
app.get('/r/:id/b/:idx', (req, res) => {
  const link = findLink(req.params.id);
  if (!link || !link.active || !link.page_json) return res.redirect(302, baseUrl(req));
  try {
    const page = JSON.parse(link.page_json);
    const idx = Number(req.params.idx);
    const btn = page.buttons && page.buttons[idx];
    if (!btn || !btn.url) return res.redirect(302, baseUrl(req));
    recordPageClick(link.id, idx, now());
    return res.redirect(302, btn.url);
  } catch {
    return res.redirect(302, baseUrl(req));
  }
});

// --- The public redirect: this is what a QR scan hits. Logs the scan, redirects. ---
app.get('/r/:id', (req, res) => {
  const link = findLink(req.params.id);
  if (!link || !link.active) return res.status(404).sendFile(join(__dirname, '..', 'public', '404.html'));
  const ts = now();
  recordScan(link.id, ts, req.headers.referer || req.headers.referrer, req.headers['user-agent']);
  emitScan(link.account_id, { linkId: link.id, title: link.title, ts });
  // Hosted-page links render an HTML page; everything else 302-redirects.
  if (link.page_json) {
    try {
      const page = JSON.parse(link.page_json);
      // "Made with Qrysm" footer carries the owner's referral code → organic growth.
      const owner = findAccountById(link.account_id);
      const homeUrl = owner && owner.ref_code ? `${baseUrl(req)}/?ref=${owner.ref_code}` : baseUrl(req);
      return res.type('html').send(renderPage(page, { title: link.title, homeUrl, pageUrl: `${baseUrl(req)}/r/${link.id}` }));
    } catch {
      return res.status(500).send('page error');
    }
  }
  res.redirect(302, link.target);
});

// Public, unauthenticated QR matrix for the landing "forge" 3D preview (no link created).
app.get('/api/demo-qr', (req, res) => {
  const text = String(req.query.text || '').slice(0, 280) || 'https://qrysm.app';
  try {
    res.json(qrMatrix(text));
  } catch {
    res.status(400).json({ error: 'bad_text' });
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true, billingEnabled }));

// Friendly route for the dashboard.
app.get('/app', (req, res) => res.sendFile(join(__dirname, '..', 'public', 'app.html')));

app.use(express.static(join(__dirname, '..', 'public')));

// Build RFC-4180-ish CSV. Quotes fields and escapes embedded quotes; prefixes a
// leading =/+/-/@ with a quote to defuse spreadsheet formula injection.
function toCsv(header, rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

// Drop the heavy logo data URL from API responses; expose a boolean instead.
function stripLogo(l) {
  const { logo, ...rest } = l;
  return { ...rest, hasLogo: !!logo };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
// Sanitize extra QR styling (currently a gradient), branding-gated. Returns an
// object or null. Built to grow (module/eye shapes) without changing the schema.
function qrStyle(body, plan) {
  if (!planLimit(plan).branding) return null;
  const s = body && body.style;
  if (!s || typeof s !== 'object') return null;
  const out = {};
  if (s.gradient && HEX.test(s.gradient.from || '') && HEX.test(s.gradient.to || '')) {
    const angle = Number(s.gradient.angle);
    out.gradient = {
      from: s.gradient.from, to: s.gradient.to,
      type: s.gradient.type === 'radial' ? 'radial' : 'linear',
      angle: Number.isFinite(angle) ? Math.max(0, Math.min(360, angle)) : 45,
    };
  }
  const shapes = ['rounded', 'dot'];
  if (shapes.includes(s.module)) out.module = s.module;
  if (shapes.includes(s.eye)) out.eye = s.eye;
  return Object.keys(out).length ? out : null;
}

// Returns sanitized brand colors, but only if the plan allows branding; otherwise
// both are null (so non-Business accounts always get the default black-on-white code).
function brandColors(body, plan) {
  if (!planLimit(plan).branding) return { colorDark: null, colorBg: null };
  const pick = (v) => (typeof v === 'string' && HEX.test(v) ? v : null);
  return { colorDark: pick(body.colorDark), colorBg: pick(body.colorBg) };
}

function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Don't auto-listen when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`Qrysm listening on :${PORT}  (billing ${billingEnabled ? 'ENABLED' : 'disabled — demo mode'})`);
  });
}

export { app, normalizeUrl };
