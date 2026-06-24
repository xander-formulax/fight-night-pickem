import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { player_id, mode } = await request.json()
  if (!player_id || !mode) {
    return NextResponse.json({ error: 'player_id and mode required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  if (mode === 'picks' || mode === 'all') {
    const { error } = await supabase.from('picks').delete().eq('player_id', player_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (mode === 'bet' || mode === 'all') {
    const { error } = await supabase.from('stoppage_bets').delete().eq('player_id', player_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
