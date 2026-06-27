// Qrysm data layer — uses Node's built-in SQLite (node:sqlite, Node >= 22.5).
// Single-file database so the app runs anywhere with zero external services.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/dynaqr.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    token       TEXT UNIQUE NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'free',
    stripe_customer TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS links (
    id          TEXT PRIMARY KEY,        -- short code used in /r/:id
    account_id  TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    target      TEXT NOT NULL,           -- destination URL (editable any time)
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS scans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id     TEXT NOT NULL,
    ts          INTEGER NOT NULL,
    referrer    TEXT,
    user_agent  TEXT,
    FOREIGN KEY (link_id) REFERENCES links(id)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    key_hash    TEXT UNIQUE NOT NULL,   -- sha256 of the secret; the secret itself is never stored
    prefix      TEXT NOT NULL,          -- first chars, for display only
    created_at  INTEGER NOT NULL,
    last_used   INTEGER,
    revoked     INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS page_clicks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id     TEXT NOT NULL,
    btn         INTEGER NOT NULL,
    ts          INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_links_account ON links(account_id);
  CREATE INDEX IF NOT EXISTS idx_scans_link ON scans(link_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);
  CREATE INDEX IF NOT EXISTS idx_clicks_link ON page_clicks(link_id);
`);

// --- Lightweight migrations: add columns to existing databases idempotently. ---
function ensureColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
// Referral tracking: each account gets a share code; referred_by records who sent them.
ensureColumn('accounts', 'ref_code', 'TEXT');
ensureColumn('accounts', 'referred_by', 'TEXT');
// Branded-QR colors (Business tier). Null = default black-on-white.
ensureColumn('links', 'color_dark', 'TEXT');
ensureColumn('links', 'color_bg', 'TEXT');
// Hosted landing page content as JSON. Null = plain redirect link.
ensureColumn('links', 'page_json', 'TEXT');
// Center logo for branded QR codes (Business tier), stored as a PNG data URL.
ensureColumn('links', 'logo', 'TEXT');
// Logo knockout shape: 'square' (default) or 'circle'.
ensureColumn('links', 'logo_shape', 'TEXT');
// Extra QR styling as JSON (gradient, module shape, eye shape) — Business tier.
ensureColumn('links', 'qr_style', 'TEXT');
// Smart routing rules as JSON (device / A-B split) — Pro tier. Null = plain redirect.
ensureColumn('links', 'rules', 'TEXT');

// Plan limits — the core monetization lever. Adding the Business tier (branded
// QR colors) lifts revenue per customer: $9 Pro → $29 Business.
export const PLAN_LIMITS = {
  free:     { maxLinks: 3, analytics: false, branding: false, label: 'Free' },
  pro:      { maxLinks: Infinity, analytics: true, branding: false, label: 'Pro' },
  business: { maxLinks: Infinity, analytics: true, branding: true, label: 'Business' },
};

export function planLimit(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

// --- Accounts ---
const insertAccount = db.prepare(
  `INSERT INTO accounts (id, email, token, plan, created_at, ref_code) VALUES (?, ?, ?, 'free', ?, ?)`
);
const getAccountByToken = db.prepare(`SELECT * FROM accounts WHERE token = ?`);
const getAccountByEmail = db.prepare(`SELECT * FROM accounts WHERE email = ?`);
const getAccountById = db.prepare(`SELECT * FROM accounts WHERE id = ?`);
const getAccountByRefCode = db.prepare(`SELECT * FROM accounts WHERE ref_code = ?`);
const setPlanStmt = db.prepare(`UPDATE accounts SET plan = ?, stripe_customer = COALESCE(?, stripe_customer) WHERE id = ?`);
const setPlanByCustomer = db.prepare(`UPDATE accounts SET plan = ? WHERE stripe_customer = ?`);
const setReferredByStmt = db.prepare(`UPDATE accounts SET referred_by = ? WHERE id = ? AND referred_by IS NULL`);
const setRefCodeStmt = db.prepare(`UPDATE accounts SET ref_code = ? WHERE id = ?`);
const countReferralsStmt = db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE referred_by = ?`);

export function createAccount(id, email, token, now, refCode) {
  insertAccount.run(id, email, token, now, refCode);
  return getAccountByToken.get(token);
}
export const findAccountByToken = (token) => (token ? getAccountByToken.get(token) : undefined);
export const findAccountByEmail = (email) => getAccountByEmail.get(email);
export const findAccountById = (id) => getAccountById.get(id);
export const findAccountByRefCode = (code) => (code ? getAccountByRefCode.get(code) : undefined);
export const setPlan = (accountId, plan, stripeCustomer = null) => setPlanStmt.run(plan, stripeCustomer, accountId);
export const setPlanForCustomer = (customerId, plan) => setPlanByCustomer.run(plan, customerId);
export const setReferredBy = (accountId, referrerId) => setReferredByStmt.run(referrerId, accountId);
export const setRefCode = (accountId, code) => setRefCodeStmt.run(code, accountId);
export const countReferrals = (accountId) => countReferralsStmt.get(accountId).n;

// --- Links ---
const insertLink = db.prepare(
  `INSERT INTO links (id, account_id, title, target, created_at, color_dark, color_bg)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const getLink = db.prepare(`SELECT * FROM links WHERE id = ?`);
const listLinksStmt = db.prepare(`SELECT * FROM links WHERE account_id = ? ORDER BY created_at DESC`);
const countLinksStmt = db.prepare(`SELECT COUNT(*) AS n FROM links WHERE account_id = ?`);
const updateLinkStmt = db.prepare(
  `UPDATE links SET title = ?, target = ?, active = ?, color_dark = ?, color_bg = ?
   WHERE id = ? AND account_id = ?`
);
const deleteLinkStmt = db.prepare(`DELETE FROM links WHERE id = ? AND account_id = ?`);

export function createLink(id, accountId, title, target, now, colorDark = null, colorBg = null) {
  insertLink.run(id, accountId, title, target, now, colorDark, colorBg);
  return getLink.get(id);
}
export const findLink = (id) => getLink.get(id);
export const listLinks = (accountId) => listLinksStmt.all(accountId);
export const countLinks = (accountId) => countLinksStmt.get(accountId).n;
export const updateLink = (id, accountId, title, target, active, colorDark = null, colorBg = null) =>
  updateLinkStmt.run(title, target, active ? 1 : 0, colorDark, colorBg, id, accountId);
// Delete a link and its scans + page clicks together (no orphaned rows).
const delScansForLink = db.prepare(`DELETE FROM scans WHERE link_id = ?`);
const delClicksForLink = db.prepare(`DELETE FROM page_clicks WHERE link_id = ?`);
export function deleteLink(id, accountId) {
  db.exec('BEGIN');
  try {
    delScansForLink.run(id);
    delClicksForLink.run(id);
    deleteLinkStmt.run(id, accountId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Set/clear the hosted-page content for a link (JSON string or null).
const setPageStmt = db.prepare(`UPDATE links SET page_json = ? WHERE id = ? AND account_id = ?`);
export const setLinkPage = (id, accountId, pageJson) => setPageStmt.run(pageJson, id, accountId);

// Set/clear the center logo (PNG data URL or null) and its knockout shape.
const setLogoStmt = db.prepare(`UPDATE links SET logo = ?, logo_shape = ? WHERE id = ? AND account_id = ?`);
export const setLinkLogo = (id, accountId, logo, shape = 'square') => setLogoStmt.run(logo, shape, id, accountId);

// Set/clear extra QR styling (gradient/module/eye) as a JSON string or null.
const setStyleStmt = db.prepare(`UPDATE links SET qr_style = ? WHERE id = ? AND account_id = ?`);
export const setLinkStyle = (id, accountId, styleJson) => setStyleStmt.run(styleJson, id, accountId);

// Set/clear smart-routing rules (device / split) as a JSON string or null.
const setRulesStmt = db.prepare(`UPDATE links SET rules = ? WHERE id = ? AND account_id = ?`);
export const setLinkRules = (id, accountId, rulesJson) => setRulesStmt.run(rulesJson, id, accountId);

// --- API keys (programmatic access). Only the sha256 hash is stored. ---
const insertApiKey = db.prepare(
  `INSERT INTO api_keys (id, account_id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)`
);
const listApiKeysStmt = db.prepare(
  `SELECT id, name, prefix, created_at, last_used, revoked FROM api_keys WHERE account_id = ? ORDER BY created_at DESC`
);
const findKeyByHash = db.prepare(`SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0`);
const revokeKeyStmt = db.prepare(`UPDATE api_keys SET revoked = 1 WHERE id = ? AND account_id = ?`);
const touchKeyStmt = db.prepare(`UPDATE api_keys SET last_used = ? WHERE id = ?`);

export function createApiKey(id, accountId, name, keyHash, prefix, now) {
  insertApiKey.run(id, accountId, name, keyHash, prefix, now);
}
export const listApiKeys = (accountId) => listApiKeysStmt.all(accountId);
export const findApiKeyByHash = (hash) => findKeyByHash.get(hash);
export const revokeApiKey = (id, accountId) => revokeKeyStmt.run(id, accountId);
export const touchApiKey = (id, ts) => touchKeyStmt.run(ts, id);

// --- Account deletion (GDPR right to erasure): remove account + its links + scans ---
const delScansForAccount = db.prepare(
  `DELETE FROM scans WHERE link_id IN (SELECT id FROM links WHERE account_id = ?)`
);
const delLinksForAccount = db.prepare(`DELETE FROM links WHERE account_id = ?`);
const delKeysForAccount = db.prepare(`DELETE FROM api_keys WHERE account_id = ?`);
const delClicksForAccount = db.prepare(`DELETE FROM page_clicks WHERE link_id IN (SELECT id FROM links WHERE account_id = ?)`);
const delAccountStmt = db.prepare(`DELETE FROM accounts WHERE id = ?`);

export function deleteAccount(accountId) {
  // Run as a single transaction so a partial delete can't leave orphaned data.
  db.exec('BEGIN');
  try {
    delScansForAccount.run(accountId);
    delClicksForAccount.run(accountId);
    delLinksForAccount.run(accountId);
    delKeysForAccount.run(accountId);
    delAccountStmt.run(accountId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// --- Scans ---
const insertScan = db.prepare(
  `INSERT INTO scans (link_id, ts, referrer, user_agent) VALUES (?, ?, ?, ?)`
);
const countScansStmt = db.prepare(`SELECT COUNT(*) AS n FROM scans WHERE link_id = ?`);
const recentScansStmt = db.prepare(`SELECT * FROM scans WHERE link_id = ? ORDER BY ts DESC LIMIT ?`);
const dailyScansStmt = db.prepare(`
  SELECT CAST(ts / 86400000 AS INTEGER) AS day, COUNT(*) AS n
  FROM scans WHERE link_id = ? AND ts >= ?
  GROUP BY day ORDER BY day ASC
`);

export const recordScan = (linkId, ts, referrer, userAgent) =>
  insertScan.run(linkId, ts, referrer || null, userAgent || null);

// --- Hosted-page button clicks ---
const insertClick = db.prepare(`INSERT INTO page_clicks (link_id, btn, ts) VALUES (?, ?, ?)`);
const clicksByBtnStmt = db.prepare(`SELECT btn, COUNT(*) AS n FROM page_clicks WHERE link_id = ? GROUP BY btn`);
export const recordPageClick = (linkId, btn, ts) => insertClick.run(linkId, btn, ts);
export const clicksByButton = (linkId) => clicksByBtnStmt.all(linkId);
export const countScans = (linkId) => countScansStmt.get(linkId).n;
const lastScanStmt = db.prepare(`SELECT MAX(ts) AS ts FROM scans WHERE link_id = ?`);
export const lastScanAt = (linkId) => lastScanStmt.get(linkId).ts;
export const recentScans = (linkId, limit = 25) => recentScansStmt.all(linkId, limit);
export const dailyScans = (linkId, sinceTs) => dailyScansStmt.all(linkId, sinceTs);
