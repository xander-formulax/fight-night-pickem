import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { fight_id, player_id, minute } = await request.json()

  if (!fight_id || !player_id || minute == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Verify player exists (must be in a pick'em game)
  const { data: player } = await supabase.from('players').select('id').eq('id', player_id).single()
  if (!player) {
    return NextResponse.json({ error: "You must sign up for a pick'em game first" }, { status: 403 })
  }

  // Verify fight has betting open
  const { data: fight } = await supabase
    .from('fights').select('stoppage_bet_open, rounds').eq('id', fight_id).single()
  if (!fight?.stoppage_bet_open) {
    return NextResponse.json({ error: 'Betting is not open for this fight' }, { status: 400 })
  }

  const maxMinute = (fight.rounds ?? 3) * 5
  if (minute < 1 || minute > maxMinute) {
    return NextResponse.json({ error: `Minute must be between 1 and ${maxMinute}` }, { status: 400 })
  }

  // Check if player already has a bet for this fight — if so, update the minute
  const { data: existing } = await supabase
    .from('stoppage_bets').select('id').eq('fight_id', fight_id).eq('player_id', player_id).single()

  if (existing) {
    const { error } = await supabase.from('stoppage_bets').update({ minute }).eq('id', existing.id)
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That minute was just taken by another player' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const { data: updated } = await supabase.from('stoppage_bets').select('*').eq('id', existing.id).single()
    return NextResponse.json({ bet: updated })
  }

  const { data: bet, error } = await supabase
    .from('stoppage_bets').insert({ fight_id, player_id, minute }).select().single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That minute was just taken by another player' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ bet })
}
