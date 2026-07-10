import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

const METHODS = ['KO/TKO', 'Submission', 'Decision'] as const

// Fills a random pick for every (player, upcoming fight) pair that has no pick yet,
// so anyone who bought an entry is scored on a full card. Coin-flip, not odds-based.
export async function POST() {
  const supabase = getSupabaseAdmin()

  const [{ data: players }, { data: fights }, { data: picks }] = await Promise.all([
    supabase.from('players').select('id'),
    supabase.from('fights').select('id, fighter_a, fighter_b, rounds, status'),
    supabase.from('picks').select('player_id, fight_id'),
  ])

  const upcoming = (fights ?? []).filter((f) => f.status === 'upcoming')
  const have = new Set((picks ?? []).map((p) => `${p.player_id}-${p.fight_id}`))

  const toInsert: Array<{
    player_id: string
    fight_id: string
    winner_pick: string
    method_pick: string
    round_pick: number | null
  }> = []

  for (const player of players ?? []) {
    for (const fight of upcoming) {
      if (have.has(`${player.id}-${fight.id}`)) continue
      const winner = Math.random() < 0.5 ? fight.fighter_a : fight.fighter_b
      const method = METHODS[randInt(0, METHODS.length - 1)]
      toInsert.push({
        player_id: player.id,
        fight_id: fight.id,
        winner_pick: winner,
        method_pick: method,
        round_pick: method === 'Decision' ? null : randInt(1, fight.rounds),
      })
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('picks').insert(toInsert)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    filled: toInsert.length,
    players: new Set(toInsert.map((p) => p.player_id)).size,
  })
}
