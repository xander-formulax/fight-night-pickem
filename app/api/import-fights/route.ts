import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { ImportedFight } from '@/app/api/import-ufc-card/route'

export async function POST(request: NextRequest) {
  const { fights, start_number } = await request.json() as {
    fights: ImportedFight[]
    start_number: number
  }

  if (!Array.isArray(fights) || fights.length === 0) {
    return NextResponse.json({ error: 'No fights provided.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const rows = fights.map((f, i) => ({
    fight_number: start_number + i,
    fighter_a: f.fighter_a,
    fighter_b: f.fighter_b,
    odds_a: f.odds_a,
    odds_b: f.odds_b,
    rounds: f.rounds,
    status: 'upcoming' as const,
  }))

  const { error } = await supabase.from('fights').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, count: rows.length })
}
