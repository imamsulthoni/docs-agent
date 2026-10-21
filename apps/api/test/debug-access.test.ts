import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:15433/postgres';

const { isDebugAdmin } = await import('../src/modules/debug/access.ts');

describe('debug endpoint access', () => {
  test('open outside production', () => {
    assert.equal(isDebugAdmin(null, 'development', []), true);
    assert.equal(isDebugAdmin(null, 'test', []), true);
  });

  test('production requires an allowlisted email', () => {
    assert.equal(isDebugAdmin(null, 'production', ['admin@example.com']), false);
    assert.equal(
      isDebugAdmin({ email: 'user@example.com' }, 'production', [
        'admin@example.com',
      ]),
      false,
    );
    assert.equal(
      isDebugAdmin({ email: 'ADMIN@example.com' }, 'production', [
        'admin@example.com',
      ]),
      true,
    );
    // No allowlist configured in production means nobody.
    assert.equal(
      isDebugAdmin({ email: 'admin@example.com' }, 'production', []),
      false,
    );
  });
});
