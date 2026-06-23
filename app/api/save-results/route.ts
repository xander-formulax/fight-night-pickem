import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { calculateScore } from '@/lib/scoring'
import type { Fight, Pick } from '@/lib/types'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { fight_id, result_winner, result_method, result_round } = body

  if (!fight_id || !result_winner || !result_method) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const { data: fight, error: fightError } = await supabase
    .from('fights')
    .update({
      result_winner,
      result_method,
      result_round: result_round ?? null,
    })
    .eq('id', fight_id)
    .select()
    .single()

  if (fightError || !fight) {
    return NextResponse.json(
      { error: fightError?.message ?? 'Fight not found' },
      { status: 500 }
    )
  }

  const { data: picks, error: picksError } = await supabase
    .from('picks')
    .select('*')
    .eq('fight_id', fight_id)

  if (picksError) {
    return NextResponse.json({ error: picksError.message }, { status: 500 })
  }

  if (!picks || picks.length === 0) {
    return NextResponse.json({ success: true, scored: 0 })
  }

  const scoresToUpsert = picks.map((pick) => {
    const result = calculateScore(fight as Fight, pick as Pick)
    return {
      player_id: pick.player_id,
      fight_id,
      winner_pts: result.winner_pts,
      method_pts: result.method_pts,
      round_pts: result.round_pts,
      fight_total: result.fight_total,
    }
  })

  const { error: scoresError } = await supabase
    .from('scores')
    .upsert(scoresToUpsert, { onConflict: 'player_id,fight_id' })

  if (scoresError) {
    return NextResponse.json({ error: scoresError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, scored: scoresToUpsert.length })
}
