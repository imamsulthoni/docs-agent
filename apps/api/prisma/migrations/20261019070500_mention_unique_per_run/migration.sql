-- DropIndex
DROP INDEX "ChatMessageMention_sessionId_runId_turn_docId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessageMention_sessionId_runId_docId_key" ON "ChatMessageMention"("sessionId", "runId", "docId");
