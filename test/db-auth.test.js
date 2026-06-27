// Unit tests for the auth/billing-integrity DB helpers added in the hardening pass:
// magic-link codes (single-use, expiring) and Stripe webhook idempotency.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'dynaqr-auth-')), 'test.db');

let db;
before(async () => { db = await import('../src/db.js'); });

test('login code is single-use and account-bound', () => {
  const acct = db.createAccount('acc_1', 'u1@example.com', 'tok_1', Date.now(), 'ref1');
  db.createLoginCode('hash_a', acct.id, Date.now() + 60000);
  assert.equal(db.consumeLoginCode('hash_a', Date.now()), acct.id, 'valid code returns account id');
  assert.equal(db.consumeLoginCode('hash_a', Date.now()), null, 'same code cannot be reused');
});

test('expired login code is rejected', () => {
  const acct = db.createAccount('acc_2', 'u2@example.com', 'tok_2', Date.now(), 'ref2');
  db.createLoginCode('hash_b', acct.id, Date.now() - 1000); // already expired
  assert.equal(db.consumeLoginCode('hash_b', Date.now()), null);
});

test('unknown login code returns null', () => {
  assert.equal(db.consumeLoginCode('does_not_exist', Date.now()), null);
});

test('stripe event ids are processed at most once', () => {
  assert.equal(db.markStripeEvent('evt_1', Date.now()), true, 'first time is new');
  assert.equal(db.markStripeEvent('evt_1', Date.now()), false, 'duplicate is rejected');
  db.unmarkStripeEvent('evt_1');
  assert.equal(db.markStripeEvent('evt_1', Date.now()), true, 'can re-process after unmark (retry path)');
});
