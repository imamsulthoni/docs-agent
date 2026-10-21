import assert from 'node:assert/strict';

process.env.CHAT_MODEL = 'openai/gpt-4o-mini';
process.env.ACCOUNT_QUOTA_MB = '1024';
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:15433/postgres';

const models = await import('../src/modules/chat/models.ts');
const pricing = await import('../src/modules/chat/pricing.ts');

assert.equal(
  models.resolveChatModel('google/gemini-2.0-flash-001'),
  'google/gemini-2.0-flash-001',
  'allowlisted model passes through',
);
assert.equal(
  models.resolveChatModel('openai/gpt-999-evil'),
  'openai/gpt-4o-mini',
  'unknown model falls back to CHAT_MODEL',
);
assert.equal(
  models.resolveChatModel(undefined),
  'openai/gpt-4o-mini',
  'missing model falls back to CHAT_MODEL',
);
assert.ok(
  models.chatModelAllowlist().includes('openai/gpt-4o-mini'),
  'allowlist contains the env default',
);

const catalog = await pricing.getModelCatalog();
assert.ok(
  Array.isArray(catalog) && catalog.length > 0,
  'catalog returns curated models',
);
assert.ok(
  catalog.every(
    (m) => typeof m.promptPerM === 'number' && typeof m.completionPerM === 'number',
  ),
  'catalog prices are numbers',
);
pricing.clearModelPriceCache();

console.log('chat models: ok');
