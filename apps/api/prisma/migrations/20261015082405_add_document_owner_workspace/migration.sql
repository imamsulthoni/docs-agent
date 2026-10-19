-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "Document_ownerId_idx" ON "Document"("ownerId");

-- CreateIndex
CREATE INDEX "Document_workspaceId_idx" ON "Document"("workspaceId");
