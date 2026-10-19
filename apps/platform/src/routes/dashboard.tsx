import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '../lib/auth'
import { DashboardPage } from '../modules/workspace/DashboardPage'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: () => requireSession(),
  component: DashboardPage,
})
