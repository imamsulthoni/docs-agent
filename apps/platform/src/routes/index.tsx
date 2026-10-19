import { createFileRoute } from '@tanstack/react-router'
import { ConvertPage } from '../modules/convert/ConvertPage'

export const Route = createFileRoute('/')({
  component: ConvertPage,
})
