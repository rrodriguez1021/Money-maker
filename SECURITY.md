# Security

This document describes Qrysm's security posture, the protections built into the
code, the residual risks you accept by running a link redirector, and an incident
runbook. It is engineering documentation, not legal advice.

## Threat model

Qrysm is a multi-tenant SaaS that (1) stores account-owned links, (2) serves a
public redirect (`/r/:id`) that anyone can hit by scanning a printed code, and
(3) takes payments via Stripe. The assets worth protecting:

- **Account access tokens / API keys** — grant full control of an account's links.
- **The redirect** — a high-traffic, unauthenticated, internet-facing endpoint.
- **The database** — link destinations + scan analytics for every tenant.
- **Stripe webhook integrity** — fake events must not grant paid plans.

## Protections in the code

| Risk | Mitigation | Where |
|------|------------|-------|
| Stolen API keys at rest | Keys stored **SHA-256 hashed**; full secret shown once | `db.js`, `server.js` `/api/keys` |
| Tenant data crossover (IDOR) | Every link mutation checks `link.account_id === req.account.id` | `server.js` link routes |
| Open redirect to dangerous schemes | `normalizeUrl()` accepts **only `http(s)`**; `javascript:`/`data:` rejected | `server.js` |
| XSS in hosted pages | Page fields sanitized + JSON escaped for inline `<script>` (escapes `<` and U+2028/9) | `page.js` |
| Forged Stripe events | Webhook verifies the **signature** with `STRIPE_WEBHOOK_SECRET` before acting | `billing.js` |
| Signup spam / scan flooding | In-memory **rate limiting** per IP+route (signup 20/min, public 600/min) | `ratelimit.js`, `server.js` |
| Oversized-payload DoS | `express.json({ limit: '1mb' })` | `server.js` |
| Clickjacking / framing | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` | `server.js` headers |
| MIME sniffing | `X-Content-Type-Options: nosniff` | `server.js` headers |
| Content injection | Conservative **CSP** (`default-src 'self'`, `object-src 'none'`) | `server.js` headers |
| Referrer leakage | `Referrer-Policy: strict-origin-when-cross-origin` | `server.js` headers |
| Downgrade attacks | `Strict-Transport-Security` asserted on HTTPS | `server.js` headers |
| Scanner privacy | We store **no full IP and set no tracking cookie** on `/r/:id` | `db.js` `recordScan` |
| CSV/formula injection | CSV exports prefix `=+-@` cells with `'` | `server.js` `toCsv` |
| Spreadsheet of scanner PII | Conversion tracking stores a **token + timestamp only** — no cookies, no IP | `server.js`, `pixel.js` |

## Residual risks you accept

- **Open redirect (by design).** A URL shortener *is* an open redirect — an account
  owner can point a code at any `http(s)` site, including a malicious one. We block
  non-web schemes but cannot vet destination *content*. Your **Acceptable Use Policy**
  (see `terms.html`) is the control here: it forbids phishing/malware, and the runbook
  below lets you kill a bad link in seconds. Consider adding a malware/phishing
  reputation check (e.g. Google Safe Browsing) before scaling outreach.
- **Passwordless tokens.** Auth is a long random bearer token, not a password+MFA.
  It's appropriate for an MVP; for higher assurance, add magic-link email re-auth and
  token rotation before storing anything sensitive behind it.
- **In-memory rate limiting.** Resets on restart and is per-process. Behind multiple
  instances, move to a shared store (Redis) or your platform's edge rate limiting.

## Operational hardening (deployment)

- Run behind the platform's TLS (Render/Fly terminate HTTPS); `trust proxy` is on so
  `req.secure`/`req.ip` are correct.
- Set secrets via environment variables only — never commit them. Required for billing:
  `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`. Optional: `PUBLIC_URL`.
- Back up the SQLite database volume (`DB_PATH`). It is the system of record.
- Keep dependencies patched: `npm audit` (currently **0 vulnerabilities**).

## Incident runbook

**A link is being used for phishing/abuse.**
1. Find the code (`/api/links` or the dashboard search).
2. **Pause it** (set `active: false` via the dashboard toggle or `PUT /api/links/:id`)
   — `/r/:id` immediately returns 404 and stops redirecting.
3. If permanent, **delete it** (`DELETE /api/links/:id`), which cascades its scans,
   clicks, and conversions in a transaction.
4. If an entire account is malicious, `DELETE /api/account` (as that account) or remove
   it directly from the database; `deleteAccount` cascades all of its data.

**A token or API key may be compromised.**
1. Revoke the API key (`DELETE /api/keys/:id`) — it's matched by hash, so revocation is
   immediate.
2. For an account token, rotate it (re-issue) and have the user sign in again.
3. Rotate `STRIPE_*` secrets in the dashboard + environment if billing keys leaked.

**Suspected data exposure.** Snapshot the DB volume, review scan/auth logs, identify
affected tenants, and follow your jurisdiction's breach-notification timelines.

## Reporting a vulnerability

Email **[security contact email]** with steps to reproduce. Please give us a reasonable
window to remediate before public disclosure. We do not yet run a paid bounty.
