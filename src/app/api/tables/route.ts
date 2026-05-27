import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { tables } from '@/lib/schema'

export async function GET() {
  const counts: Record<string, number> = {}

  await Promise.all(
    Object.keys(tables).map(async (t) => {
      try {
        const res = await pool.query(`SELECT COUNT(*) FROM "${t}"`)
        counts[t] = parseInt(res.rows[0].count)
      } catch {
        counts[t] = -1
      }
    })
  )

  return NextResponse.json(counts)
}
