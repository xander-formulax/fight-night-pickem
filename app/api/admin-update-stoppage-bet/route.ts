import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { bet_id, round_pick, minute_pick, second_pick } = await request.json()
  if (!bet_id || round_pick == null || minute_pick == null || second_pick == null) {
    return NextResponse.json({ error: 'bet_id, round_pick, minute_pick, second_pick required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('stoppage_bets')
    .update({ round_pick, minute_pick, second_pick })
    .eq('id', bet_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
