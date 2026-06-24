import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { fight_id, stoppage_bet_open, stoppage_bet_fee } = await request.json()

  if (!fight_id) {
    return NextResponse.json({ error: 'fight_id is required' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (stoppage_bet_open !== undefined) updates.stoppage_bet_open = stoppage_bet_open
  if (stoppage_bet_fee !== undefined) updates.stoppage_bet_fee = String(stoppage_bet_fee)

  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('fights').update(updates).eq('id', fight_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
