import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables } from '@/lib/schema'

export async function GET() {
  const counts: Record<string, number> = {}

  await Promise.all(
    Object.keys(tables).map(async (t) => {
      try {
        const { count } = await supabaseAdmin
          .from(t)
          .select('*', { count: 'exact', head: true })
        counts[t] = count ?? 0
      } catch {
        counts[t] = -1
      }
    })
  )

  return NextResponse.json(counts)
}
