import { artifactBytes } from "../modules/documents/artifacts.js";
import { prisma } from "../utils/prisma.js";

/**
 * One-off/idempotent backfill for `Document.sizeBytes` (added in Fase 5).
 * Documents converted before the column existed start at 0, which under-counts
 * the account quota until this runs.
 *
 * Usage: pnpm --filter @docs-agent/api db:backfill-sizes
 */
async function main(): Promise<void> {
  const docs = await prisma.document.findMany({
    select: { id: true, sizeBytes: true },
  });
  let updated = 0;
  for (const doc of docs) {
    const bytes = await artifactBytes(doc.id);
    if (bytes === doc.sizeBytes) continue;
    await prisma.document.update({
      where: { id: doc.id },
      data: { sizeBytes: bytes },
    });
    updated += 1;
    console.log(`[backfill:sizes] doc=${doc.id} ${doc.sizeBytes} -> ${bytes}`);
  }
  console.log(`[backfill:sizes] done: ${updated}/${docs.length} updated`);
}

main()
  .catch((err) => {
    console.error("[backfill:sizes] failed", err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
