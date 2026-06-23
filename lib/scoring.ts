import type { Fight, Pick } from './types'

export interface ScoreResult {
  winner_pts: number
  method_pts: number
  round_pts: number
  fight_total: number
}

export function calculateScore(fight: Fight, pick: Pick): ScoreResult {
  let winner_pts = 0
  let method_pts = 0
  let round_pts = 0

  if (!fight.result_winner || !fight.result_method) {
    return { winner_pts, method_pts, round_pts, fight_total: 0 }
  }

  if (pick.winner_pick === fight.result_winner) {
    const odds = pick.winner_pick === fight.fighter_a ? fight.odds_a : fight.odds_b

    if (odds > 0) {
      winner_pts = odds
    } else if (odds < 0) {
      winner_pts = Math.round((100 / Math.abs(odds)) * 100)
    } else {
      winner_pts = 100
    }

    if (pick.method_pick === fight.result_method) {
      if (pick.method_pick === 'KO/TKO') method_pts = 100
      else if (pick.method_pick === 'Submission') method_pts = 150
      else if (pick.method_pick === 'Decision') method_pts = 50

      if (
        pick.method_pick !== 'Decision' &&
        pick.round_pick != null &&
        pick.round_pick === fight.result_round
      ) {
        round_pts = 100
      }
    }
  }

  return {
    winner_pts,
    method_pts,
    round_pts,
    fight_total: winner_pts + method_pts + round_pts,
  }
}

export function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`
}
