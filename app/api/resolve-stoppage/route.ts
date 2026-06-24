import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

// minute_pick is 1-indexed (1 = 0:00-0:59, 2 = 1:00-1:59, etc.)
// actual_minute is clock-display (0-4)
function pickToSeconds(round: number, minutePick: number, second: number) {
  return (round - 1) * 300 + (minutePick - 1) * 60 + second
}

export async function POST(request: NextRequest) {
  const { fight_id, actual_round, actual_minute, actual_second } = await request.json()

  if (!fight_id || actual_round == null || actual_minute == null || actual_second == null) {
    return NextResponse.json({ error: 'fight_id, actual_round, actual_minute, actual_second are required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  await supabase.from('fights').update({
    stoppage_actual_round: actual_round,
    stoppage_actual_minute: actual_minute,
    stoppage_actual_second: actual_second,
  }).eq('id', fight_id)

  // actual_minute here is clock display (0-4); convert to minute_pick (1-5) for comparison
  const actualSeconds = (actual_round - 1) * 300 + actual_minute * 60 + actual_second

  const { data: bets } = await supabase
    .from('stoppage_bets').select('*').eq('fight_id', fight_id).eq('activated', true)

  // Price Is Right: highest pick that doesn't exceed actual
  const winner = (bets ?? [])
    .filter((b) => pickToSeconds(b.round_pick, b.minute_pick, b.second_pick) <= actualSeconds)
    .sort((a, b) =>
      pickToSeconds(b.round_pick, b.minute_pick, b.second_pick) -
      pickToSeconds(a.round_pick, a.minute_pick, a.second_pick)
    )[0] ?? null

  return NextResponse.json({ winner, actual_round, actual_minute, actual_second })
}
