// DynaQR — dynamic QR code + link tracking SaaS.
//
// What makes it monetizable: a QR code printed on a flyer, menu, or product is
// permanent, but with DynaQR the *destination* behind it is editable forever and
// every scan is tracked. Free users get 3 codes; Pro (Stripe subscription) gets
// unlimited codes + scan analytics. That recurring upgrade is the revenue.

import express from 'express';
import { customAlphabet } from 'nanoid';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createAccount, findAccountByToken, findAccountByEmail, findAccountById,
  setPlan, setPlanForCustomer, planLimit,
  createLink, findLink, listLinks, countLinks, updateLink, deleteLink,
  recordScan, countScans, recentScans, dailyScans,
} from './db.js';
import {
  billingEnabled, createCheckoutSession, constructEvent, customerIdFromEvent,
} from './billing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const app = express();

// URL-safe, unambiguous short codes (no look-alike chars).
const shortId = customAlphabet('346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz', 7);
const accountId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
const tokenId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 40);
const now = () => Date.now();

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return process.env.PUBLIC_URL || `${proto}://${req.get('host')}`;
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
      if (acct) setPlan(acct.id, 'pro', s.customer);
    } else if (event.type === 'customer.subscription.deleted') {
      if (customer) setPlanForCustomer(customer, 'free');
    } else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      if (customer) setPlanForCustomer(customer, sub.status === 'active' ? 'pro' : 'free');
    }
  })().catch((e) => console.error('webhook handler error', e));

  res.json({ received: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Auth: lightweight token-based accounts. POST an email, get a token.
// For an MVP this is passwordless-by-token; swap in magic-link email in prod. ---
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const account = findAccountByToken(token);
  if (!account) return res.status(401).json({ error: 'unauthorized', hint: 'Pass Bearer token from /api/signup' });
  req.account = account;
  next();
}

app.post('/api/signup', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid_email' });
  const existing = findAccountByEmail(email);
  if (existing) return res.json({ token: existing.token, plan: existing.plan, returning: true });
  const acct = createAccount(accountId(), email, tokenId(), now());
  res.json({ token: acct.token, plan: acct.plan, returning: false });
});

app.get('/api/me', auth, (req, res) => {
  const limit = planLimit(req.account.plan);
  res.json({
    email: req.account.email,
    plan: req.account.plan,
    limits: { maxLinks: limit.maxLinks === Infinity ? null : limit.maxLinks, analytics: limit.analytics },
    used: countLinks(req.account.id),
    billingEnabled,
  });
});

// --- Links CRUD ---
app.get('/api/links', auth, (req, res) => {
  const links = listLinks(req.account.id).map((l) => ({
    ...l, active: !!l.active, scans: countScans(l.id), shortUrl: `${baseUrl(req)}/r/${l.id}`,
  }));
  res.json({ links });
});

app.post('/api/links', auth, (req, res) => {
  const target = normalizeUrl(req.body.target);
  if (!target) return res.status(400).json({ error: 'invalid_target', hint: 'Provide a valid http(s) URL' });
  const limit = planLimit(req.account.plan);
  if (countLinks(req.account.id) >= limit.maxLinks) {
    return res.status(402).json({ error: 'limit_reached', plan: req.account.plan, maxLinks: limit.maxLinks,
      hint: 'Upgrade to Pro for unlimited dynamic QR codes.' });
  }
  const title = String(req.body.title || '').slice(0, 120);
  const link = createLink(shortId(), req.account.id, title, target, now());
  res.status(201).json({ ...link, active: !!link.active, shortUrl: `${baseUrl(req)}/r/${link.id}` });
});

app.put('/api/links/:id', auth, (req, res) => {
  const link = findLink(req.params.id);
  if (!link || link.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
  const target = req.body.target !== undefined ? normalizeUrl(req.body.target) : link.target;
  if (!target) return res.status(400).json({ error: 'invalid_target' });
  const title = req.body.title !== undefined ? String(req.body.title).slice(0, 120) : link.title;
  const active = req.body.active !== undefined ? !!req.body.active : !!link.active;
  updateLink(link.id, req.account.id, title, target, active);
  res.json({ ...findLink(link.id), active });
});

app.delete('/api/links/:id', auth, (req, res) => {
  const link = findLink(req.params.id);
  if (!link || link.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
  deleteLink(link.id, req.account.id);
  res.json({ deleted: true });
});

// --- QR image for a link (PNG or SVG). The QR encodes the stable short URL. ---
app.get('/api/links/:id/qr.:fmt', auth, async (req, res) => {
  const link = findLink(req.params.id);
  if (!link || link.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
  const url = `${baseUrl(req)}/r/${link.id}`;
  const opts = { margin: 1, width: 512, errorCorrectionLevel: 'M' };
  try {
    if (req.params.fmt === 'svg') {
      res.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
    } else {
      res.type('image/png').send(await QRCode.toBuffer(url, opts));
    }
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
  res.json({
    total: countScans(link.id),
    daily: dailyScans(link.id, since).map((d) => ({ date: new Date(d.day * 86400000).toISOString().slice(0, 10), scans: d.n })),
    recent: recentScans(link.id, 25).map((s) => ({ ts: s.ts, referrer: s.referrer, userAgent: s.user_agent })),
  });
});

// --- Billing: start a checkout to upgrade to Pro ---
app.post('/api/billing/checkout', auth, async (req, res) => {
  if (!billingEnabled) return res.status(503).json({ error: 'billing_disabled', hint: 'Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID.' });
  try {
    const session = await createCheckoutSession(req.account, baseUrl(req));
    res.json({ url: session.url });
  } catch (e) {
    console.error('checkout error', e);
    res.status(500).json({ error: 'checkout_failed' });
  }
});

// --- The public redirect: this is what a QR scan hits. Logs the scan, redirects. ---
app.get('/r/:id', (req, res) => {
  const link = findLink(req.params.id);
  if (!link || !link.active) return res.status(404).sendFile(join(__dirname, '..', 'public', '404.html'));
  recordScan(link.id, now(), req.headers.referer || req.headers.referrer, req.headers['user-agent']);
  res.redirect(302, link.target);
});

app.get('/healthz', (req, res) => res.json({ ok: true, billingEnabled }));

// Friendly route for the dashboard.
app.get('/app', (req, res) => res.sendFile(join(__dirname, '..', 'public', 'app.html')));

app.use(express.static(join(__dirname, '..', 'public')));

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
    console.log(`DynaQR listening on :${PORT}  (billing ${billingEnabled ? 'ENABLED' : 'disabled — demo mode'})`);
  });
}

export { app, normalizeUrl };
