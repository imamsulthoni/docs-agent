-- CreateTable
CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL DEFAULT '',
    "messageRef" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "markdown" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatAttachment_ownerId_sessionId_idx" ON "ChatAttachment"("ownerId", "sessionId");

-- CreateIndex
CREATE INDEX "ChatAttachment_sessionId_idx" ON "ChatAttachment"("sessionId");
