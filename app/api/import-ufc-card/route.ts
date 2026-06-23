import { NextResponse } from 'next/server'

interface OddsOutcome {
  name: string
  price: number
}

interface OddsMarket {
  key: string
  outcomes: OddsOutcome[]
}

interface OddsBookmaker {
  key: string
  markets: OddsMarket[]
}

interface OddsEvent {
  id: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: OddsBookmaker[]
}

export interface ImportedFight {
  fighter_a: string
  fighter_b: string
  odds_a: number
  odds_b: number
  rounds: number
}

export interface ImportEventGroup {
  date: string
  fights: ImportedFight[]
}

const PREFERRED_BOOKS = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'pointsbetus', 'betonlineag']

function pickOdds(event: OddsEvent): { odds_a: number; odds_b: number } | null {
  const sources = [
    ...PREFERRED_BOOKS.map((k) => event.bookmakers.find((b) => b.key === k)).filter(Boolean),
    ...event.bookmakers,
  ]
  for (const book of sources) {
    if (!book) continue
    const market = book.markets.find((m) => m.key === 'h2h')
    if (!market) continue
    const a = market.outcomes.find((o) => o.name === event.home_team)
    const b = market.outcomes.find((o) => o.name === event.away_team)
    if (a && b) return { odds_a: a.price, odds_b: b.price }
  }
  return null
}

export async function GET() {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ODDS_API_KEY is not set in environment variables.' }, { status: 500 })
  }

  let res: Response
  try {
    res = await fetch(
      `https://api.the-odds-api.com/v4/sports/mma_mixed_martial_arts/odds?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american`,
      { cache: 'no-store' }
    )
  } catch {
    return NextResponse.json({ error: 'Failed to reach The Odds API. Check your connection.' }, { status: 502 })
  }

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `Odds API returned ${res.status}: ${text}` }, { status: res.status })
  }

  const events: OddsEvent[] = await res.json()

  // Group fights by date (YYYY-MM-DD)
  const groups: Record<string, ImportedFight[]> = {}
  for (const event of events) {
    const date = event.commence_time.slice(0, 10)
    const odds = pickOdds(event)
    if (!odds) continue
    if (!groups[date]) groups[date] = []
    groups[date].push({
      fighter_a: event.home_team,
      fighter_b: event.away_team,
      odds_a: odds.odds_a,
      odds_b: odds.odds_b,
      rounds: 3,
    })
  }

  const result: ImportEventGroup[] = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, fights]) => ({ date, fights }))

  return NextResponse.json({ events: result })
}
