-- Per-document artifact bytes for the per-account storage quota.
-- Existing rows start at 0 and are filled by `pnpm --filter @docs-agent/api db:backfill-sizes`.
ALTER TABLE "Document" ADD COLUMN "sizeBytes" INTEGER NOT NULL DEFAULT 0;
