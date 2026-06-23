import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { id, fight_number, fighter_a, fighter_b, odds_a, odds_b, rounds } = body

  if (!fight_number || !fighter_a || !fighter_b || odds_a === undefined || odds_b === undefined || !rounds) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  if (id) {
    const { error } = await supabase
      .from('fights')
      .update({ fight_number, fighter_a, fighter_b, odds_a, odds_b, rounds })
      .eq('id', id)
      .eq('status', 'upcoming')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase
      .from('fights')
      .insert({ fight_number, fighter_a, fighter_b, odds_a, odds_b, rounds, status: 'upcoming' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
