'use client'

import { useEffect, useState, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import type { Competition, Fight, Player, Pick, Score, PlayerWithScores } from '@/lib/types'

function RankBadge({ rank }: { rank: number }) {
  const base = 'w-10 text-center inline-block font-black'
  if (rank === 1) return <span className={`${base} text-3xl text-yellow-400`}>1</span>
  if (rank === 2) return <span className={`${base} text-3xl text-gray-300`}>2</span>
  if (rank === 3) return <span className={`${base} text-3xl text-amber-600`}>3</span>
  return <span className={`${base} text-2xl text-gray-600`}>{rank}</span>
}

function PlayerModal({
  entry, fights, picks, onClose,
}: {
  entry: PlayerWithScores
  fights: Fight[]
  picks: Pick[]
  onClose: () => void
}) {
  const playerPicks = picks.filter((p) => p.player_id === entry.player.id)
  const pickMap: Record<string, Pick> = {}
  playerPicks.forEach((p) => { pickMap[p.fight_id] = p })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-800">
          <div>
            <h2 className="text-2xl font-black text-white">{entry.player.name}</h2>
            <p className="text-gray-500 text-sm mt-0.5">
              {entry.player.competition_id ? '' : entry.player.tier}
            </p>
          </div>
          <div className="text-right">
            <div className="text-4xl font-black text-green-400">{entry.total}</div>
            <div className="text-gray-600 text-xs">total pts</div>
          </div>
        </div>

        {/* Per-fight breakdown */}
        <div className="divide-y divide-gray-800">
          {fights.map((fight) => {
            const pick = pickMap[fight.id]
            const score = entry.scores[fight.id]
            const isComplete = fight.status === 'complete'
            const hasResult = isComplete && fight.result_winner

            return (
              <div key={fight.id} className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-gray-600 text-xs font-semibold">FIGHT {fight.fight_number}</span>
                    <p className="text-white font-bold mt-0.5">
                      {fight.fighter_a} <span className="text-gray-600 font-normal">vs</span> {fight.fighter_b}
                    </p>
                  </div>
                  <div className={`text-xs px-2 py-1 rounded-full font-bold ${
                    isComplete ? 'bg-green-900 text-green-300' :
                    fight.status === 'locked' ? 'bg-yellow-900 text-yellow-300' :
                    'bg-blue-900 text-blue-300'
                  }`}>
                    {fight.status.toUpperCase()}
                  </div>
                </div>

                {pick ? (
                  <div className="space-y-2">
                    {/* Their pick */}
                    <div className="bg-gray-800 rounded-lg px-4 py-2.5">
                      <p className="text-xs text-gray-500 mb-1">Your pick</p>
                      <p className="text-sm">
                        <span className="text-white font-bold">{pick.winner_pick}</span>
                        <span className="text-gray-500 mx-1.5">by</span>
                        <span className="text-orange-400 font-semibold">{pick.method_pick}</span>
                        {pick.round_pick != null && (
                          <span className="text-gray-500 ml-1.5">· Round {pick.round_pick}</span>
                        )}
                      </p>
                    </div>

                    {/* Result + score */}
                    {hasResult ? (
                      <div className="bg-gray-800/60 rounded-lg px-4 py-2.5">
                        <p className="text-xs text-gray-500 mb-1">Result</p>
                        <p className="text-sm">
                          <span className="text-white font-bold">{fight.result_winner}</span>
                          <span className="text-gray-500 mx-1.5">by</span>
                          <span className="text-gray-300">{fight.result_method}</span>
                          {fight.result_round != null && (
                            <span className="text-gray-500 ml-1.5">· Round {fight.result_round}</span>
                          )}
                        </p>
                        {score ? (
                          <div className="flex items-center gap-3 mt-2">
                            {score.winner_pts > 0 && (
                              <span className="text-xs text-gray-400">
                                Winner <span className="text-green-400 font-bold">+{score.winner_pts}</span>
                              </span>
                            )}
                            {score.method_pts > 0 && (
                              <span className="text-xs text-gray-400">
                                Method <span className="text-blue-400 font-bold">+{score.method_pts}</span>
                              </span>
                            )}
                            {score.round_pts > 0 && (
                              <span className="text-xs text-gray-400">
                                Round <span className="text-purple-400 font-bold">+{score.round_pts}</span>
                              </span>
                            )}
                            <span className="ml-auto text-white font-black text-lg">
                              {score.fight_total > 0 ? `+${score.fight_total}` : '0'} pts
                            </span>
                          </div>
                        ) : (
                          <p className="text-gray-700 text-xs mt-1">No points scored</p>
                        )}
                      </div>
                    ) : isComplete ? (
                      <p className="text-gray-700 text-xs px-1">Awaiting scoring</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-gray-700 text-sm italic">No pick submitted for this fight</p>
                )}
              </div>
            )
          })}
        </div>

        <div className="p-4 border-t border-gray-800">
          <button
            onClick={onClose}
            className="w-full bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function parseFee(fee: string) { return parseFloat(fee.replace(/[^0-9.]/g, '')) || 0 }
function ordinal(n: number) {
  if (n === 1) return '1st'; if (n === 2) return '2nd'; if (n === 3) return '3rd'; return `${n}th`
}

function calcPrizePool(
  comp: Competition,
  allComps: Competition[],
  allPlayers: Player[],
  partyCostTarget: number
) {
  let totalExpenseContrib = 0
  allComps.forEach((c) => {
    const paid = allPlayers.filter((p) => p.competition_id === c.id && p.paid).length
    totalExpenseContrib += paid * parseFee(c.entry_fee) * ((c.expense_cut_pct ?? 50) / 100)
  })
  const surplus = partyCostTarget > 0 ? Math.max(0, totalExpenseContrib - partyCostTarget) : 0
  const paidCount = allPlayers.filter((p) => p.competition_id === comp.id && p.paid).length
  const fee = parseFee(comp.entry_fee)
  const poolExpenseContrib = paidCount * fee * ((comp.expense_cut_pct ?? 50) / 100)
  const poolSurplus = totalExpenseContrib > 0 ? (poolExpenseContrib / totalExpenseContrib) * surplus : 0
  const prizePool = paidCount * fee * (1 - (comp.expense_cut_pct ?? 50) / 100) + poolSurplus
  return {
    paidCount,
    prizePool,
    places: (comp.prize_splits ?? []).map((s) => ({ place: s.place, pct: s.pct, amount: prizePool * s.pct / 100 })),
  }
}

export default function LeaderboardPage() {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [activeCompId, setActiveCompId] = useState<string>('')
  const [fights, setFights] = useState<Fight[]>([])
  const [allPlayers, setAllPlayers] = useState<Player[]>([])
  const [allScores, setAllScores] = useState<Score[]>([])
  const [allPicks, setAllPicks] = useState<Pick[]>([])
  const [partyCostTarget, setPartyCostTarget] = useState(0)
  const [lastUpdate, setLastUpdate] = useState('')
  const [expandedEntry, setExpandedEntry] = useState<PlayerWithScores | null>(null)

  const buildEntries = useCallback(
    (players: Player[], scores: Score[], compId: string): PlayerWithScores[] => {
      const filtered = players.filter((p) => p.competition_id === compId)
      const map: Record<string, PlayerWithScores> = {}
      filtered.forEach((p) => { map[p.id] = { player: p, scores: {}, total: 0 } })
      scores.forEach((s) => {
        if (map[s.player_id]) {
          map[s.player_id].scores[s.fight_id] = s
          map[s.player_id].total += s.fight_total
        }
      })
      return Object.values(map).sort((a, b) => b.total - a.total)
    },
    []
  )

  const loadData = useCallback(async () => {
    const supabase = getSupabaseBrowser()
    const [{ data: compsData }, { data: fightsData }, { data: playersData }, { data: scoresData }, { data: picksData }, settingsRes] =
      await Promise.all([
        supabase.from('competitions').select('*').order('created_at'),
        supabase.from('fights').select('*').order('fight_number'),
        supabase.from('players').select('*'),
        supabase.from('scores').select('*'),
        supabase.from('picks').select('*'),
        fetch('/api/event-settings'),
      ])

    if (compsData) {
      setCompetitions(compsData)
      setActiveCompId((prev) => prev || compsData[0]?.id || '')
    }
    if (fightsData) setFights(fightsData)
    if (playersData) setAllPlayers(playersData)
    if (scoresData) setAllScores(scoresData)
    if (picksData) setAllPicks(picksData)
    if (settingsRes.ok) {
      const s = await settingsRes.json()
      setPartyCostTarget(parseFloat(s.party_cost_target) || 0)
    }
    setLastUpdate(new Date().toLocaleTimeString())
  }, [])

  useEffect(() => {
    loadData()
    const supabase = getSupabaseBrowser()
    const channel = supabase
      .channel('leaderboard-scores')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, () => loadData())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadData])

  const activeComp = competitions.find((c) => c.id === activeCompId)
  const entries = activeCompId ? buildEntries(allPlayers, allScores, activeCompId) : []

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-5xl md:text-8xl font-black text-red-500 tracking-tight leading-none">
          FIGHT NIGHT
        </h1>
        <h2 className="text-3xl md:text-5xl font-black text-white mt-1 tracking-widest">
          LEADERBOARD
        </h2>
        {lastUpdate && (
          <p className="text-gray-600 text-sm mt-2">Live &bull; {lastUpdate}</p>
        )}
      </div>

      {/* Competition tabs */}
      {competitions.length > 1 && (
        <div className="flex flex-wrap justify-center gap-3 mb-6">
          {competitions.map((comp) => (
            <button
              key={comp.id}
              onClick={() => setActiveCompId(comp.id)}
              className={`px-6 py-3 rounded-xl font-black text-lg md:text-xl transition-colors ${
                activeCompId === comp.id
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {comp.name}
              <span className={`ml-2 text-base font-bold ${activeCompId === comp.id ? 'text-red-200' : 'text-gray-600'}`}>
                {comp.entry_fee}
              </span>
            </button>
          ))}
        </div>
      )}

      {competitions.length === 1 && activeComp && (
        <p className="text-center text-gray-500 text-sm mb-4">
          {activeComp.name} &bull; {activeComp.entry_fee}
        </p>
      )}

      {/* Prize display */}
      {activeComp && (() => {
        const { paidCount, prizePool, places } = calcPrizePool(activeComp, competitions, allPlayers, partyCostTarget)
        if (paidCount === 0 || places.length === 0) return null
        return (
          <div className="text-center mb-6">
            <p className="text-gray-600 text-xs uppercase tracking-widest mb-3">Current Prizes</p>
            <div className="flex justify-center gap-6 md:gap-10 flex-wrap">
              {places.map((p) => (
                <div key={p.place}>
                  <div className={`font-black tabular-nums ${
                    p.place === 1 ? 'text-4xl md:text-5xl text-yellow-400' :
                    p.place === 2 ? 'text-3xl md:text-4xl text-gray-300' :
                    p.place === 3 ? 'text-2xl md:text-3xl text-amber-600' :
                    'text-2xl text-green-400'
                  }`}>
                    ${p.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-gray-600 text-xs mt-1 uppercase tracking-wider">{ordinal(p.place)}</div>
                </div>
              ))}
            </div>
            <p className="text-gray-700 text-xs mt-3">
              {paidCount} paid · ${prizePool.toLocaleString(undefined, { maximumFractionDigits: 0 })} prize pool
            </p>
          </div>
        )
      })()}

      {/* Fight status pills */}
      {fights.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {fights.map((f) => (
            <div
              key={f.id}
              className={`px-3 py-1.5 rounded-lg text-center border text-xs font-bold ${
                f.status === 'complete'
                  ? 'bg-green-900/40 border-green-700 text-green-300'
                  : f.status === 'locked'
                  ? 'bg-yellow-900/40 border-yellow-700 text-yellow-300'
                  : 'bg-gray-800 border-gray-700 text-gray-500'
              }`}
            >
              <span className="uppercase tracking-wide">F{f.fight_number}</span>
              {f.result_winner && <span className="ml-1.5 font-black">{f.result_winner}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Leaderboard */}
      {competitions.length === 0 ? (
        <div className="text-center text-gray-700 text-3xl font-black mt-20 tracking-widest">
          NO COMPETITIONS SET UP
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center text-gray-700 text-3xl font-black mt-20 tracking-widest">
          WAITING FOR PLAYERS
        </div>
      ) : (
        <div className="max-w-2xl mx-auto space-y-2">
          <p className="text-center text-gray-700 text-xs mb-4 tracking-wider">TAP A NAME TO SEE THEIR PICKS</p>
          {entries.map((entry, idx) => {
            const rank = idx + 1
            const isFirst = rank === 1
            const isTop3 = rank <= 3
            return (
              <button
                key={entry.player.id}
                onClick={() => setExpandedEntry(entry)}
                className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border transition-all text-left cursor-pointer hover:border-gray-600 active:scale-[0.99] ${
                  isFirst
                    ? 'bg-yellow-900/15 border-yellow-800/40 hover:bg-yellow-900/25'
                    : isTop3
                    ? 'bg-gray-800/40 border-gray-700/40'
                    : 'bg-gray-900/60 border-gray-800/30'
                }`}
              >
                <div className="shrink-0 w-10 text-right">
                  <RankBadge rank={rank} />
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className={`font-black tracking-tight leading-none truncate ${
                      isFirst
                        ? 'text-3xl md:text-4xl text-yellow-300'
                        : isTop3
                        ? 'text-2xl md:text-3xl text-white'
                        : 'text-xl md:text-2xl text-gray-200'
                    }`}
                  >
                    {entry.player.name}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`font-black ${
                      isFirst
                        ? 'text-5xl md:text-6xl text-yellow-300'
                        : isTop3
                        ? 'text-4xl md:text-5xl text-white'
                        : 'text-3xl md:text-4xl text-gray-300'
                    }`}
                  >
                    {entry.total}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Player detail modal */}
      {expandedEntry && (
        <PlayerModal
          entry={expandedEntry}
          fights={fights}
          picks={allPicks}
          onClose={() => setExpandedEntry(null)}
        />
      )}
    </div>
  )
}
