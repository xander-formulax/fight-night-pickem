import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { bet_id, paid } = await request.json()
  if (!bet_id || paid == null) return NextResponse.json({ error: 'bet_id and paid are required' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('stoppage_bets').update({ jackpot_paid: paid }).eq('id', bet_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
