import { notFound } from 'next/navigation'
import { tables } from '@/lib/schema'
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
    <div className="p-8">
      <DataTable tableName={table} schema={schema} />
    </div>
  )
}
