import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

// Deletes a single entry outright — the player's picks, scores, jackpot bets,
// and the player row itself. Frees the pool slot so they can enter again, and
// clears any outstanding payment-due (an unpaid entry simply disappears).
export async function POST(request: NextRequest) {
  const { player_id } = await request.json()
  if (!player_id) return NextResponse.json({ error: 'Missing player_id' }, { status: 400 })

  const supabase = getSupabaseAdmin()

  // Remove child rows first (don't rely on ON DELETE CASCADE), then the entry.
  await supabase.from('scores').delete().eq('player_id', player_id)
  await supabase.from('picks').delete().eq('player_id', player_id)
  await supabase.from('stoppage_bets').delete().eq('player_id', player_id)

  const { error } = await supabase.from('players').delete().eq('id', player_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
