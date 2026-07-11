import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST() {
  const supabase = getSupabaseAdmin()

  // Delete in FK-safe order (no ON DELETE CASCADE in this schema — children first).
  // Fail loudly: a partial reset that reports success poisons the next event.
  const order = ['stoppage_bets', 'scores', 'picks', 'players', 'fights'] as const

  for (const table of order) {
    const { error } = await supabase.from(table).delete().not('id', 'is', null)
    if (error) {
      return NextResponse.json(
        { error: `Reset failed while clearing ${table}: ${error.message}` },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ success: true })
}
