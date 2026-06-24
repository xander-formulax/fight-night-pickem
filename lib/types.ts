export interface PrizeSplit {
  place: number
  pct: number
}

export interface Competition {
  id: string
  name: string
  entry_fee: string
  description?: string | null
  expense_cut_pct: number
  prize_splits: PrizeSplit[]
  created_at: string
}

export interface Fight {
  id: string
  fight_number: number
  fighter_a: string
  fighter_b: string
  odds_a: number
  odds_b: number
  rounds: number
  status: 'upcoming' | 'locked' | 'complete'
  result_winner?: string | null
  result_method?: 'KO/TKO' | 'Submission' | 'Decision' | null
  result_round?: number | null
  created_at: string
}

export interface Player {
  id: string
  name: string
  contact?: string
  tier: string
  competition_id?: string | null
  paid: boolean
  activated: boolean
  created_at: string
}

export interface Pick {
  id: string
  player_id: string
  fight_id: string
  winner_pick: string
  method_pick: 'KO/TKO' | 'Submission' | 'Decision'
  round_pick?: number | null
}

export interface Score {
  id: string
  player_id: string
  fight_id: string
  winner_pts: number
  method_pts: number
  round_pts: number
  fight_total: number
}

export interface PlayerWithScores {
  player: Player
  scores: Record<string, Score>
  total: number
}
