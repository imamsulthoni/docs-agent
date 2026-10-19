# DocsAgent

> DocsAgent — PDFs in, answers out: Markdown conversion, RAG chat, and
> AI-generated BRDs & QA test cases.

A pnpm workspace for DocsAgent: upload a PDF, view the converted markdown, and
chat with that document via RAG — with the vision to generate BRDs (in the
team's standard format) and QA test cases. The workspace includes the platform
UI, API gateway + indexing worker, and a shared agent library. PDF conversion
is handled by a separate HTTP service (sibling repo
`pdf-md-conversion-service-py` or a remote `CONVERTER_URL`).

## Stack

- **Platform**: Vite, React, TypeScript, TanStack Router, Tailwind
- **API / worker**: Hono, local artifact storage, BullMQ, Postgres, Redis, Qdrant
- **Agent**: TypeScript library (retrieval + answer pipeline)
- **Converter**: external REST service (`pdf-md-conversion-service-py` or `CONVERTER_URL`)
- **Tooling**: pnpm workspace, Docker Compose for infra

## Preparation & step to run

**Prep**

- Node 20+, pnpm 9 (`corepack enable`), Docker
- Converter running locally (sibling repo) or via `CONVERTER_URL`
- Copy `.env.example` → `.env` (root) and `apps/platform/.env.example` → `apps/platform/.env`
- `DATABASE_URL` is required (API and worker refuse to start without it). Set Redis/Qdrant URLs, and `OPENAI_API_KEY` to enable chat.

**Run** (PowerShell)

```powershell
pnpm install

# 1) converter (:8379) — from sibling repo pdf-md-conversion-service-py
# start uvicorn on 127.0.0.1:8379 (see that repo's README)

# 2) infra
docker compose up -d db redis qdrant

# 3) gateway + worker
pnpm db:generate
pnpm db:migrate
pnpm dev:api
pnpm dev:worker   # second terminal

# 4) platform
pnpm dev:platform
```

Open http://127.0.0.1:8378

Ports: platform `8378`, API `8377`, converter `8379`, Postgres `15433`, Redis `16379`, Qdrant `6333`.

## Features & app flow

- Upload PDF as a background job (progress, cancel; resumes after reload)
- View rendered markdown at `/r/<docId>`
- Worker indexes the document; chat unlocks when indexing finishes
- Per-document, per-session RAG chat ("Ask this document")
- List / delete documents; download when available
- Roadmap: generate BRDs (standard-format templates) and QA test cases from
  indexed documents

```
Upload PDF → API → Converter
                ← markdown + image bytes
           API stores files → View markdown
                           ↘ Worker indexes → RAG chat
```

## Artifact storage

`apps/api` owns conversion artifacts. The converter returns Markdown and image
bytes once; the API writes them under:

```text
apps/api/data/public/{docId}/
├── doc.md
├── meta.json
├── images/
└── scans/
```

The directory is ignored by Git. Configure it with:

- `ARTIFACT_DIR`: storage path; defaults to `apps/api/data/public`.
- `ARTIFACT_MAX_MB`: maximum local usage before new conversion results return
  HTTP `507`; defaults to `1024`.
- `INDEX_SWEEP_MINUTES`: interval for removing files past `expires_at`.

The API serves these files through `/public/{docId}/...`. The worker reads
`doc.md` from the same directory and does not call converter download or static
file endpoints.

For MVP, API and worker must run on the same machine and share `ARTIFACT_DIR`.

### Roadmap: move artifacts to R2

The plan is to move artifact storage to Cloudflare R2 (or another S3-compatible
object store) so the API and worker no longer need to share a local disk:

- Replace the artifact-store implementation in `apps/api` with an R2-backed
  one (same `doc.md` / `meta.json` / `images` layout as object keys).
- Serve files through presigned URLs or keep proxying via the API, so the
  `/public/{docId}/...` URL contract does not change.
- API and worker can then scale independently; no shared volume required.
