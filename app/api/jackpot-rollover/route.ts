import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getStorageConfig } from '@/lib/storage-config'

export async function POST(request: NextRequest) {
  const { from_fight_id, to_fight_id } = await request.json()
  if (!from_fight_id || !to_fight_id) {
    return NextResponse.json({ error: 'from_fight_id and to_fight_id required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const [{ data: fromFight }, { data: bets }, { data: toFight }, config] = await Promise.all([
    supabase.from('fights').select('stoppage_bet_fee, jackpot_rollover').eq('id', from_fight_id).single(),
    supabase.from('stoppage_bets').select('id').eq('fight_id', from_fight_id).eq('activated', true),
    supabase.from('fights').select('jackpot_rollover').eq('id', to_fight_id).single(),
    getStorageConfig(supabase),
  ])

  const fee = parseFloat(fromFight?.stoppage_bet_fee ?? '20') || 20
  // The house/expense cut is taken off new entries only; a carried-over rollover is already net.
  const cut = Math.max(0, Math.min(100, parseFloat(config.jackpot_expense_cut_pct ?? '0') || 0)) / 100
  const rolloverAmount = (bets?.length ?? 0) * fee * (1 - cut) + (fromFight?.jackpot_rollover ?? 0)
  const newTotal = (toFight?.jackpot_rollover ?? 0) + rolloverAmount

  const { error } = await supabase.from('fights').update({ jackpot_rollover: newTotal }).eq('id', to_fight_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, rolloverAmount })
}
