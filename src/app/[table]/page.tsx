import { notFound } from 'next/navigation'
import { tables } from '@/lib/schema'
import DataTable from '@/components/DataTable'

interface Props {
  params: { table: string }
  searchParams: { view?: string }
}

export function generateStaticParams() {
  return Object.keys(tables).map(table => ({ table }))
}

export default function TablePage({ params, searchParams }: Props) {
  const { table } = params
  const schema = tables[table]
  if (!schema) notFound()

  // ?view=novos vem do cartão de pendências de controladoria do Dashboard —
  // abre a tabela já filtrada em "Somente Novos" (ver DataTable.tsx).
  const initialViewMode = searchParams.view === 'novos' ? 'novos' : undefined

  return (
    <div className="p-8">
      <DataTable tableName={table} schema={schema} initialViewMode={initialViewMode} />
    </div>
  )
}
