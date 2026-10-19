// Dev harness: smoke-test the doc-QA agent from CLI (cermin runner-dev.ts
// referensi; tinggal di apps/api karena wiring infra — prisma, Qdrant,
// embedding model — hidup di sini, bukan di packages/agent).
//
// Usage: pnpm --filter @docs-agent/api runner:dev -- <docId> <question...>
import { getDocStatus } from './modules/documents/store.js'
import { streamAnswer } from './modules/chat/service.js'

const [docId = '', ...questionParts] = process.argv.slice(2)
const question = questionParts.join(' ').trim()

if (!docId || !question) {
  console.error('Usage: runner:dev -- <docId> <question...>')
  process.exit(1)
}

const status = await getDocStatus(docId)
if (!status.found || !status.isProcessed) {
  console.error(`Document ${docId} is not indexed yet (run a convert + worker first).`)
  process.exit(1)
}

const sessionId = `doc:${docId}:s:runnerdev`
const userId = 'fp:runner-dev'

for await (const event of streamAnswer(docId, sessionId, userId, question, status.summary)) {
  if (event.type === 'text_delta') process.stdout.write(event.delta)
  else if (event.type === 'citations') {
    process.stdout.write('\n\n[citations]\n')
    for (const c of event.citations) process.stdout.write(`p.${c.page}: ${c.excerpt}\n`)
  } else if (event.type === 'error') {
    console.error(`\n[error] ${event.message}`)
    process.exit(1)
  }
}
process.stdout.write('\n')
process.exit(0)
