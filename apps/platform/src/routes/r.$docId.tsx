import { createFileRoute } from '@tanstack/react-router'
import { ResultPage } from '../modules/preview/ResultPage'

export const Route = createFileRoute('/r/$docId')({
  component: ResultRoute,
})

function ResultRoute() {
  const { docId } = Route.useParams()
  return <ResultPage docId={docId} />
}
