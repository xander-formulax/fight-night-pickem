'use client'

import { useEffect, useState, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import type { Fight, Player, Score, PlayerWithScores } from '@/lib/types'

function FightStatusPill({ fight }: { fight: Fight }) {
  const base = 'px-3 py-2 rounded-lg text-center border text-xs font-bold'
  const cls =
    fight.status === 'complete'
      ? `${base} bg-green-900/40 border-green-700 text-green-300`
      : fight.status === 'locked'
      ? `${base} bg-yellow-900/40 border-yellow-700 text-yellow-300`
      : `${base} bg-gray-800 border-gray-700 text-gray-500`

  return (
    <div className={cls}>
      <div className="uppercase tracking-wide">F{fight.fight_number}</div>
      <div className="mt-0.5 font-normal opacity-80 normal-case tracking-normal leading-tight">
        {fight.fighter_a}
        <br />
        vs
        <br />
        {fight.fighter_b}
      </div>
      {fight.result_winner && (
        <div className="mt-1 font-black text-sm">{fight.result_winner}</div>
      )}
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="text-3xl font-black text-yellow-400 w-10 text-center inline-block">1</span>
    )
  if (rank === 2)
    return (
      <span className="text-3xl font-black text-gray-300 w-10 text-center inline-block">2</span>
    )
  if (rank === 3)
    return (
      <span className="text-3xl font-black text-amber-600 w-10 text-center inline-block">3</span>
    )
  return (
    <span className="text-2xl font-bold text-gray-600 w-10 text-center inline-block">{rank}</span>
  )
}

export default function LeaderboardPage() {
  const [fights, setFights] = useState<Fight[]>([])
  const [entries, setEntries] = useState<PlayerWithScores[]>([])
  const [lastUpdate, setLastUpdate] = useState<string>('')

  const buildLeaderboard = useCallback(
    (players: Player[], scores: Score[], fights: Fight[]) => {
      const map: Record<string, PlayerWithScores> = {}
      players.forEach((p) => {
        map[p.id] = { player: p, scores: {}, total: 0 }
      })
      scores.forEach((s) => {
        if (map[s.player_id]) {
          map[s.player_id].scores[s.fight_id] = s
          map[s.player_id].total += s.fight_total
        }
      })
      setFights(fights)
      setEntries(
        Object.values(map).sort((a, b) => b.total - a.total)
      )
      setLastUpdate(new Date().toLocaleTimeString())
    },
    []
  )

  const loadData = useCallback(async () => {
    const supabase = getSupabaseBrowser()
    const [{ data: fightsData }, { data: playersData }, { data: scoresData }] = await Promise.all([
      supabase.from('fights').select('*').order('fight_number'),
      supabase.from('players').select('*'),
      supabase.from('scores').select('*'),
    ])

    if (fightsData && playersData && scoresData) {
      buildLeaderboard(playersData, scoresData, fightsData)
    }
  }, [buildLeaderboard])

  useEffect(() => {
    loadData()

    const supabase = getSupabaseBrowser()
    const channel = supabase
      .channel('leaderboard-scores')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scores' },
        () => { loadData() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [loadData])

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
          <p className="text-gray-600 text-sm mt-2">
            Live &bull; {lastUpdate}
          </p>
        )}
      </div>

      {/* Fight Status Row */}
      {fights.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {fights.map((f) => (
            <FightStatusPill key={f.id} fight={f} />
          ))}
        </div>
      )}

      {/* Table */}
      {entries.length === 0 ? (
        <div className="text-center text-gray-700 text-3xl font-black mt-20 tracking-widest">
          WAITING FOR PLAYERS
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-800">
                <th className="pb-3 pr-3 w-12" />
                <th className="text-left pb-3 text-gray-500 text-xs uppercase tracking-widest font-semibold">
                  Player
                </th>
                {fights.map((f) => (
                  <th
                    key={f.id}
                    className="pb-3 px-2 text-center text-gray-600 text-xs uppercase tracking-wider font-semibold min-w-[70px]"
                  >
                    <div>F{f.fight_number}</div>
                    <div
                      className={`w-2 h-2 rounded-full mx-auto mt-1 ${
                        f.status === 'complete'
                          ? 'bg-green-500'
                          : f.status === 'locked'
                          ? 'bg-yellow-500'
                          : 'bg-gray-700'
                      }`}
                    />
                  </th>
                ))}
                <th className="pb-3 pl-4 text-center text-white text-sm uppercase tracking-widest font-black">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => {
                const rank = idx + 1
                const isFirst = rank === 1
                const isTop3 = rank <= 3

                return (
                  <tr
                    key={entry.player.id}
                    className={`border-b border-gray-800/40 ${
                      isFirst
                        ? 'bg-yellow-900/10'
                        : isTop3
                        ? 'bg-gray-800/10'
                        : ''
                    }`}
                  >
                    <td className="py-4 pr-3 text-right">
                      <RankBadge rank={rank} />
                    </td>

                    <td className="py-4 pr-4">
                      <div
                        className={`font-black tracking-tight leading-none ${
                          isFirst
                            ? 'text-3xl md:text-4xl text-yellow-300'
                            : isTop3
                            ? 'text-2xl md:text-3xl text-white'
                            : 'text-xl md:text-2xl text-gray-200'
                        }`}
                      >
                        {entry.player.name}
                      </div>
                      <div className="text-gray-600 text-xs mt-0.5">{entry.player.tier}</div>
                    </td>

                    {fights.map((f) => {
                      const score = entry.scores[f.id]
                      return (
                        <td key={f.id} className="py-4 px-2 text-center">
                          {score ? (
                            <div>
                              <div
                                className={`font-black ${
                                  isFirst
                                    ? 'text-2xl md:text-3xl'
                                    : isTop3
                                    ? 'text-xl md:text-2xl'
                                    : 'text-lg md:text-xl'
                                } ${
                                  score.fight_total > 0 ? 'text-green-400' : 'text-gray-700'
                                }`}
                              >
                                {score.fight_total || '—'}
                              </div>
                              {score.fight_total > 0 && (
                                <div className="text-gray-600 text-xs mt-0.5 leading-tight">
                                  {score.winner_pts > 0 && (
                                    <span>W:{score.winner_pts}</span>
                                  )}
                                  {score.method_pts > 0 && (
                                    <span className="ml-1">M:{score.method_pts}</span>
                                  )}
                                  {score.round_pts > 0 && (
                                    <span className="ml-1">R:{score.round_pts}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-700 text-xl">—</span>
                          )}
                        </td>
                      )
                    })}

                    <td className="py-4 pl-4 text-center">
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
