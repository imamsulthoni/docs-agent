import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '../lib/auth'
import { ResultPage } from '../modules/preview/ResultPage'

export const Route = createFileRoute('/w/$workspaceId_/d/$docId')({
  beforeLoad: () => requireSession(),
  component: WorkspaceDocRoute,
})

function WorkspaceDocRoute() {
  const { workspaceId, docId } = Route.useParams()
  return <ResultPage docId={docId} workspaceId={workspaceId} />
}
