import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:15433/postgres';

const { checkRateLimit } = await import('../src/middleware/rateLimit.ts');

describe('fixed-window rate limit', () => {
  test('allows up to max, then blocks with retry-after', () => {
    const hits = new Map<string, number[]>();
    assert.equal(checkRateLimit(hits, 'k', 0, 2).allowed, true);
    assert.equal(checkRateLimit(hits, 'k', 1_000, 2).allowed, true);
    const blocked = checkRateLimit(hits, 'k', 2_000, 2);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfter > 0);
  });

  test('keys are isolated from each other', () => {
    const hits = new Map<string, number[]>();
    assert.equal(checkRateLimit(hits, 'u:a', 0, 1).allowed, true);
    assert.equal(checkRateLimit(hits, 'u:a', 0, 1).allowed, false);
    assert.equal(checkRateLimit(hits, 'u:b', 0, 1).allowed, true);
  });

  test('window resets after a minute', () => {
    const hits = new Map<string, number[]>();
    assert.equal(checkRateLimit(hits, 'k', 0, 1).allowed, true);
    assert.equal(checkRateLimit(hits, 'k', 30_000, 1).allowed, false);
    assert.equal(checkRateLimit(hits, 'k', 60_001, 1).allowed, true);
  });

  test('max <= 0 disables the limiter', () => {
    const hits = new Map<string, number[]>();
    assert.equal(checkRateLimit(hits, 'k', 0, 0).allowed, true);
    assert.equal(checkRateLimit(hits, 'k', 0, 0).allowed, true);
  });
});
