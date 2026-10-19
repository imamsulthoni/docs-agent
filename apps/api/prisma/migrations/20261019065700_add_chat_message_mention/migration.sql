-- CreateTable
CREATE TABLE "ChatMessageMention" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "docId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "documentName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessageMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMessageMention_sessionId_idx" ON "ChatMessageMention"("sessionId");

-- CreateIndex
CREATE INDEX "ChatMessageMention_docId_idx" ON "ChatMessageMention"("docId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessageMention_sessionId_runId_turn_docId_key" ON "ChatMessageMention"("sessionId", "runId", "turn", "docId");
