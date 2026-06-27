// Unit tests for the pure rate-limiter core. No server, no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateHit } from '../src/ratelimit.js';

test('allows hits up to the limit, then blocks', () => {
  const store = new Map();
  const t0 = 1000;
  for (let i = 1; i <= 3; i++) {
    assert.equal(rateHit(store, 'a', t0, 60000, 3).limited, false, `hit ${i} should pass`);
  }
  assert.equal(rateHit(store, 'a', t0, 60000, 3).limited, true, '4th hit should be blocked');
});

test('window resets after it elapses', () => {
  const store = new Map();
  assert.equal(rateHit(store, 'k', 0, 1000, 1).limited, false);
  assert.equal(rateHit(store, 'k', 500, 1000, 1).limited, true);  // still in window
  assert.equal(rateHit(store, 'k', 1500, 1000, 1).limited, false); // window expired
});

test('keys are isolated from each other', () => {
  const store = new Map();
  assert.equal(rateHit(store, 'ip1', 0, 60000, 1).limited, false);
  assert.equal(rateHit(store, 'ip1', 0, 60000, 1).limited, true);
  assert.equal(rateHit(store, 'ip2', 0, 60000, 1).limited, false); // different key unaffected
});

test('reports a sane retryAfter in seconds', () => {
  const store = new Map();
  const { retryAfter } = rateHit(store, 'r', 0, 30000, 1);
  assert.equal(retryAfter, 30);
});
