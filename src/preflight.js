// Production readiness check. Catches the misconfigurations that make a launch
// silently fail — e.g. Stripe keys set but no webhook secret, so payments succeed
// but never upgrade the account. Run with `npm run preflight`.
import { fileURLToPath } from 'node:url';

export function checkReadiness(env = process.env) {
  const out = [];
  const add = (name, status, detail) => out.push({ name, status, detail });

  // Public URL — QR codes encode this; wrong/unset means codes point at the wrong host.
  if (!env.PUBLIC_URL) {
    add('Public URL', 'warn', 'PUBLIC_URL not set — QR codes use the incoming request host. Set it to your real https domain.');
  } else if (!/^https:\/\//i.test(env.PUBLIC_URL)) {
    add('Public URL', 'warn', `PUBLIC_URL is "${env.PUBLIC_URL}" — should be https:// in production.`);
  } else {
    add('Public URL', 'pass', env.PUBLIC_URL);
  }

  // Database persistence.
  if (!env.DB_PATH) {
    add('Database', 'warn', 'DB_PATH unset — using ./data/dynaqr.db. Ensure this lives on a persistent volume so links/scans survive restarts.');
  } else {
    add('Database', 'pass', env.DB_PATH);
  }

  // Billing configuration.
  const key = env.STRIPE_SECRET_KEY;
  const price = env.STRIPE_PRICE_ID;
  const hook = env.STRIPE_WEBHOOK_SECRET;
  if (!key && !price) {
    add('Billing', 'warn', 'Stripe not configured — app runs in demo mode (no paid upgrades). Add keys to charge customers.');
  } else if (key && price) {
    add('Billing', 'pass', 'Stripe secret key + Pro price present.');
    add('Stripe mode', key.startsWith('sk_live') ? 'pass' : 'warn',
      key.startsWith('sk_live') ? 'LIVE keys — real charges.' : 'TEST keys — no real charges will occur.');
    add('Webhook', hook ? 'pass' : 'fail',
      hook ? 'Signing secret present.' : 'STRIPE_WEBHOOK_SECRET missing — payments will succeed but accounts will NOT upgrade. Add the webhook signing secret.');
    if (env.STRIPE_PRICE_ID_BUSINESS) add('Business tier', 'pass', 'Business price configured.');
    if (env.STRIPE_PRICE_ID_ANNUAL || env.STRIPE_PRICE_ID_BUSINESS_ANNUAL) add('Annual billing', 'pass', 'Annual price(s) configured.');
  } else {
    add('Billing', 'fail', 'Incomplete Stripe config — set BOTH STRIPE_SECRET_KEY and STRIPE_PRICE_ID (or neither for demo mode).');
  }

  return out;
}

export function summarize(results) {
  const fail = results.filter((r) => r.status === 'fail').length;
  const warn = results.filter((r) => r.status === 'warn').length;
  return { ok: fail === 0, fail, warn, total: results.length };
}

function render(results) {
  const sym = { pass: '✓', warn: '!', fail: '✗' };
  const lines = results.map((r) => `  ${sym[r.status] || '?'}  ${r.name.padEnd(14)} ${r.detail}`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = checkReadiness();
  const s = summarize(results);
  console.log('\nDynaQR preflight\n');
  console.log(render(results));
  console.log(`\n${s.fail} blocking, ${s.warn} warnings.\n`);
  process.exit(s.ok ? 0 : 1);
}
