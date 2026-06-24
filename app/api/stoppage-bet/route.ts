import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { fight_id, player_id, round_pick, minute_pick, second_pick } = await request.json()

  if (!fight_id || !player_id || !round_pick || !minute_pick || second_pick == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const { data: player } = await supabase.from('players').select('id').eq('id', player_id).single()
  if (!player) {
    return NextResponse.json({ error: "You must sign up for a pick'em game first" }, { status: 403 })
  }

  const { data: fight } = await supabase
    .from('fights').select('stoppage_bet_open, rounds').eq('id', fight_id).single()
  if (!fight?.stoppage_bet_open) {
    return NextResponse.json({ error: 'Betting is not open for this fight' }, { status: 400 })
  }

  if (round_pick < 1 || round_pick > fight.rounds) {
    return NextResponse.json({ error: `Round must be between 1 and ${fight.rounds}` }, { status: 400 })
  }
  if (minute_pick < 1 || minute_pick > 5) {
    return NextResponse.json({ error: 'Minute must be between 1 and 5' }, { status: 400 })
  }
  if (second_pick < 0 || second_pick > 59) {
    return NextResponse.json({ error: 'Second must be between 0 and 59' }, { status: 400 })
  }

  // Picks are final — no changes after confirming
  const { data: existing } = await supabase
    .from('stoppage_bets').select('id').eq('fight_id', fight_id).eq('player_id', player_id).single()
  if (existing) {
    return NextResponse.json({ error: 'Your pick is locked and cannot be changed' }, { status: 409 })
  }

  const { data: bet, error } = await supabase
    .from('stoppage_bets')
    .insert({ fight_id, player_id, round_pick, minute_pick, second_pick })
    .select().single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That exact second is already taken — pick another' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ bet })
}
