import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { player_id, fight_id, winner_pick, method_pick, round_pick } = await request.json()
  if (!player_id || !fight_id || !winner_pick || !method_pick) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Delete existing pick then re-insert (avoids needing a DB unique constraint)
  await supabase.from('picks').delete().eq('player_id', player_id).eq('fight_id', fight_id)

  const { error } = await supabase.from('picks').insert({
    player_id,
    fight_id,
    winner_pick,
    method_pick,
    round_pick: round_pick ?? null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
