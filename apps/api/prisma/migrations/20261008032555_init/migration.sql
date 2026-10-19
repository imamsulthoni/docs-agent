-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "markdownUrl" TEXT,
    "stats" JSONB,
    "summary" TEXT,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPage" (
    "id" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "documentId" TEXT NOT NULL,

    CONSTRAINT "DocumentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemorySession" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemorySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemoryMessage" (
    "id" TEXT NOT NULL,
    "memorySessionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "message" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMemoryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemoryError" (
    "id" TEXT NOT NULL,
    "memorySessionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "error" JSONB NOT NULL,
    "messages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMemoryError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentPage_documentId_idx" ON "DocumentPage"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPage_documentId_pageNumber_key" ON "DocumentPage"("documentId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMemorySession_scopeKey_key" ON "AgentMemorySession"("scopeKey");

-- CreateIndex
CREATE INDEX "AgentMemorySession_sessionId_userId_idx" ON "AgentMemorySession"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "AgentMemoryMessage_runId_idx" ON "AgentMemoryMessage"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMemoryMessage_memorySessionId_position_key" ON "AgentMemoryMessage"("memorySessionId", "position");

-- CreateIndex
CREATE INDEX "AgentMemoryError_runId_idx" ON "AgentMemoryError"("runId");

-- AddForeignKey
ALTER TABLE "DocumentPage" ADD CONSTRAINT "DocumentPage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemoryMessage" ADD CONSTRAINT "AgentMemoryMessage_memorySessionId_fkey" FOREIGN KEY ("memorySessionId") REFERENCES "AgentMemorySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemoryError" ADD CONSTRAINT "AgentMemoryError_memorySessionId_fkey" FOREIGN KEY ("memorySessionId") REFERENCES "AgentMemorySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
