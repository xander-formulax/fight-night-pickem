import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { name, competition_id, picks } = body

  if (!name || !competition_id || !Array.isArray(picks) || picks.length === 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const { data: competition } = await supabase
    .from('competitions')
    .select('entry_fee')
    .eq('id', competition_id)
    .single()

  if (!competition) {
    return NextResponse.json({ error: 'Competition not found' }, { status: 400 })
  }

  const { data: player, error: playerError } = await supabase
    .from('players')
    .insert({
      name,
      contact: '',
      tier: competition.entry_fee,
      competition_id,
      tiebreaker: '',
      paid: false,
      activated: false,
    })
    .select()
    .single()

  if (playerError || !player) {
    return NextResponse.json(
      { error: playerError?.message ?? 'Failed to create player' },
      { status: 500 }
    )
  }

  const picksToInsert = picks.map((pick: {
    fight_id: string
    winner_pick: string
    method_pick: string
    round_pick: number | null
  }) => ({
    player_id: player.id,
    fight_id: pick.fight_id,
    winner_pick: pick.winner_pick,
    method_pick: pick.method_pick,
    round_pick: pick.round_pick ?? null,
  }))

  const { error: picksError } = await supabase.from('picks').insert(picksToInsert)

  if (picksError) {
    await supabase.from('players').delete().eq('id', player.id)
    return NextResponse.json({ error: picksError.message }, { status: 500 })
  }

  return NextResponse.json({ player_id: player.id })
}
