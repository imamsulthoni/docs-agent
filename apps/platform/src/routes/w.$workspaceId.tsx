import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '../lib/auth'
import { WorkspacePage } from '../modules/workspace/WorkspacePage'

export const Route = createFileRoute('/w/$workspaceId')({
  beforeLoad: () => requireSession(),
  component: WorkspaceRoute,
})

function WorkspaceRoute() {
  const { workspaceId } = Route.useParams()
  return <WorkspacePage workspaceId={workspaceId} />
}
