import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReadiness, summarize } from '../src/preflight.js';

const find = (rs, name) => rs.find((r) => r.name === name);

test('demo mode (no Stripe) is OK with warnings, not blocking', () => {
  const rs = checkReadiness({});
  assert.equal(summarize(rs).ok, true);
  assert.equal(find(rs, 'Billing').status, 'warn');
});

test('Stripe key without webhook secret is a blocking failure', () => {
  const rs = checkReadiness({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PRICE_ID: 'price_x' });
  assert.equal(find(rs, 'Webhook').status, 'fail');
  assert.equal(summarize(rs).ok, false);
});

test('incomplete Stripe config (key but no price) blocks', () => {
  const rs = checkReadiness({ STRIPE_SECRET_KEY: 'sk_live_x' });
  assert.equal(find(rs, 'Billing').status, 'fail');
  assert.equal(summarize(rs).ok, false);
});

test('fully configured live setup passes', () => {
  const rs = checkReadiness({
    PUBLIC_URL: 'https://qr.example.com',
    DB_PATH: '/data/dynaqr.db',
    STRIPE_SECRET_KEY: 'sk_live_x',
    STRIPE_PRICE_ID: 'price_pro',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_ID_BUSINESS: 'price_biz',
  });
  assert.equal(summarize(rs).ok, true);
  assert.equal(find(rs, 'Public URL').status, 'pass');
  assert.equal(find(rs, 'Stripe mode').status, 'pass');
  assert.equal(find(rs, 'Business tier').status, 'pass');
});

test('test-mode keys warn but do not block', () => {
  const rs = checkReadiness({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  assert.equal(find(rs, 'Stripe mode').status, 'warn');
  assert.equal(summarize(rs).ok, true);
});
