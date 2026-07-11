import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { fight_id } = await request.json()
  if (!fight_id) return NextResponse.json({ error: 'Missing fight_id' }, { status: 400 })

  const supabase = getSupabaseAdmin()

  // Only upcoming fights may be deleted — check BEFORE touching children, so we
  // never strip bets/picks/scores off a fight that then survives.
  const { data: fight } = await supabase.from('fights').select('id, status').eq('id', fight_id).single()
  if (!fight) return NextResponse.json({ error: 'Fight not found' }, { status: 404 })
  if (fight.status !== 'upcoming') {
    return NextResponse.json({ error: 'Only upcoming fights can be deleted' }, { status: 400 })
  }

  // Delete children first (FK constraints, no cascade), then the fight
  await supabase.from('stoppage_bets').delete().eq('fight_id', fight_id)
  await supabase.from('scores').delete().eq('fight_id', fight_id)
  await supabase.from('picks').delete().eq('fight_id', fight_id)
  const { error } = await supabase.from('fights').delete().eq('id', fight_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
