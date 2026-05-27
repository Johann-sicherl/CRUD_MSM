import { notFound } from 'next/navigation'
import { tables, DOMAIN_LABELS } from '@/lib/schema'
import DataTable from '@/components/DataTable'

interface Props {
  params: { table: string }
}

export function generateStaticParams() {
  return Object.keys(tables).map(table => ({ table }))
}

export default function TablePage({ params }: Props) {
  const { table } = params
  const schema = tables[table]
  if (!schema) notFound()

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
          {DOMAIN_LABELS[schema.domain]} · {table}
        </div>
        <h1 className="text-2xl font-bold text-slate-800">{schema.label}</h1>
        <p className="text-slate-500 text-sm mt-1">{schema.description}</p>
      </div>

      <DataTable tableName={table} schema={schema} />
    </div>
  )
}
