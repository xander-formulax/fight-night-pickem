import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { fight_id, actual_minute } = await request.json()

  if (!fight_id || actual_minute == null) {
    return NextResponse.json({ error: 'fight_id and actual_minute are required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Save actual minute on the fight record
  await supabase.from('fights').update({ stoppage_actual_minute: actual_minute }).eq('id', fight_id)

  // Find winner: highest activated bet whose minute <= actual_minute (Price is Right rule)
  const { data: bets } = await supabase
    .from('stoppage_bets')
    .select('*')
    .eq('fight_id', fight_id)
    .eq('activated', true)
    .lte('minute', actual_minute)
    .order('minute', { ascending: false })
    .limit(1)

  const winner = bets?.[0] ?? null
  return NextResponse.json({ winner, actual_minute })
}
