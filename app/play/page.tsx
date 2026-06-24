'use client'

import { useEffect, useState, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatOdds } from '@/lib/scoring'
import type { Competition, Fight, Player, Pick } from '@/lib/types'

type Method = 'KO/TKO' | 'Submission' | 'Decision'

interface PickState {
  winner_pick: string
  method_pick: Method | ''
  round_pick: string
}

function winnerPts(odds: number): number {
  if (odds > 0) return odds
  if (odds < 0) return Math.round((100 / Math.abs(odds)) * 100)
  return 100
}

const METHOD_PTS: Record<string, number> = { 'KO/TKO': 100, Submission: 150, Decision: 50 }

function calcPotential(fight: Fight, pick: PickState | undefined) {
  if (!pick?.winner_pick) return null
  const odds = pick.winner_pick === fight.fighter_a ? fight.odds_a : fight.odds_b
  const winner = winnerPts(odds)
  const method = pick.method_pick ? (METHOD_PTS[pick.method_pick] ?? 0) : 0
  const round = pick.method_pick && pick.method_pick !== 'Decision' && pick.round_pick ? 100 : 0
  return { winner, method, round, total: winner + method + round }
}

function StatusBadge({ status }: { status: Fight['status'] }) {
  const cls =
    status === 'complete'
      ? 'bg-green-900 text-green-300'
      : status === 'locked'
      ? 'bg-yellow-900 text-yellow-300'
      : 'bg-blue-900 text-blue-300'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cls}`}>
      {status.toUpperCase()}
    </span>
  )
}

export default function PlayPage() {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [fights, setFights] = useState<Fight[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [existingPlayer, setExistingPlayer] = useState<Player | null>(null)
  const [existingPicks, setExistingPicks] = useState<Pick[]>([])

  const [name, setName] = useState('')
  const [selectedCompetitionId, setSelectedCompetitionId] = useState('')
  const [picks, setPicks] = useState<Record<string, PickState>>({})
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    const supabase = getSupabaseBrowser()

    const [{ data: compsData }, { data: fightsData }] = await Promise.all([
      supabase.from('competitions').select('*').order('created_at'),
      supabase.from('fights').select('*').order('fight_number'),
    ])

    if (compsData) setCompetitions(compsData)
    if (fightsData) {
      setFights(fightsData)
      setPicks((prev) => {
        const next: Record<string, PickState> = {}
        fightsData.forEach((f) => {
          next[f.id] = prev[f.id] ?? { winner_pick: '', method_pick: '', round_pick: '' }
        })
        return next
      })
    }

    const playerId =
      typeof window !== 'undefined' ? localStorage.getItem('fight_night_player_id') : null

    if (playerId) {
      const { data: playerData } = await supabase
        .from('players')
        .select('*')
        .eq('id', playerId)
        .single()
      if (playerData) {
        setExistingPlayer(playerData)
        const { data: picksData } = await supabase
          .from('picks')
          .select('*')
          .eq('player_id', playerId)
        if (picksData) setExistingPicks(picksData)
      }
    }

    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  function updatePick(fightId: string, field: keyof PickState, value: string) {
    setPicks((prev) => ({
      ...prev,
      [fightId]: {
        ...prev[fightId],
        [field]: value,
        ...(field === 'method_pick' && value === 'Decision' ? { round_pick: '' } : {}),
      },
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!selectedCompetitionId) {
      setError('Please select a prize pool to enter.')
      return
    }

    const upcomingFights = fights.filter((f) => f.status === 'upcoming')

    for (const fight of upcomingFights) {
      const pick = picks[fight.id]
      if (!pick?.winner_pick) {
        setError(`Please pick a winner for Fight ${fight.fight_number}: ${fight.fighter_a} vs ${fight.fighter_b}`)
        return
      }
      if (!pick?.method_pick) {
        setError(`Please pick a method for Fight ${fight.fight_number}: ${fight.fighter_a} vs ${fight.fighter_b}`)
        return
      }
      if (pick.method_pick !== 'Decision' && !pick.round_pick) {
        setError(`Please pick a round for Fight ${fight.fight_number}: ${fight.fighter_a} vs ${fight.fighter_b}`)
        return
      }
    }

    if (upcomingFights.length === 0) {
      setError('No open fights available for picks.')
      return
    }

    setSubmitting(true)

    const picksToSubmit = upcomingFights.map((fight) => ({
      fight_id: fight.id,
      winner_pick: picks[fight.id].winner_pick,
      method_pick: picks[fight.id].method_pick as Method,
      round_pick:
        picks[fight.id].method_pick !== 'Decision'
          ? parseInt(picks[fight.id].round_pick, 10)
          : null,
    }))

    const res = await fetch('/api/submit-picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        competition_id: selectedCompetitionId,
        picks: picksToSubmit,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      setError(result.error ?? 'Failed to submit picks. Please try again.')
      setSubmitting(false)
      return
    }

    localStorage.setItem('fight_night_player_id', result.player_id)
    setSubmitting(false)
    await loadData()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-400 animate-pulse">Loading...</div>
      </div>
    )
  }

  const selectedComp = competitions.find((c) => c.id === existingPlayer?.competition_id)

  // ── Confirmation view ─────────────────────────────────────────────────────
  if (existingPlayer) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black text-red-500 tracking-tight">UFC FIGHT NIGHT</h1>
          <h2 className="text-2xl font-bold text-white mt-1">PICK'EM</h2>
        </div>

        {!existingPlayer.activated ? (
          <div className="bg-yellow-900/40 border border-yellow-600 rounded-xl p-5 mb-6 text-center">
            <p className="text-yellow-300 font-bold text-lg">
              Your picks are locked until payment is confirmed.
            </p>
            <p className="text-yellow-500 text-sm mt-1">
              Contact the organizer to complete your payment.
            </p>
          </div>
        ) : (
          <div className="bg-green-900/40 border border-green-600 rounded-xl p-5 mb-6 text-center">
            <p className="text-green-300 font-bold text-lg">
              Your entry is confirmed and activated!
            </p>
          </div>
        )}

        <div className="bg-gray-900 rounded-xl p-6 mb-6">
          <h3 className="text-lg font-bold text-white mb-3">Your Entry Details</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-gray-500">Name</dt>
              <dd className="text-white font-semibold">{existingPlayer.name}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Prize Pool</dt>
              <dd className="text-white font-semibold">
                {selectedComp ? `${selectedComp.name} (${selectedComp.entry_fee})` : existingPlayer.tier}
              </dd>
            </div>
          </dl>
        </div>

        <h3 className="text-lg font-bold text-white mb-3">Your Picks</h3>
        <div className="space-y-3">
          {fights.map((fight) => {
            const pick = existingPicks.find((p) => p.fight_id === fight.id)
            return (
              <div key={fight.id} className="bg-gray-900 rounded-xl p-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-gray-500 text-xs font-medium">FIGHT {fight.fight_number}</span>
                  <StatusBadge status={fight.status} />
                </div>
                <div className="text-white font-semibold mb-1">
                  {fight.fighter_a} vs {fight.fighter_b}
                </div>
                {pick ? (
                  <div className="text-sm">
                    <span className="text-red-400 font-bold">{pick.winner_pick}</span>
                    <span className="text-gray-500 mx-1">by</span>
                    <span className="text-orange-400">{pick.method_pick}</span>
                    {pick.round_pick != null && (
                      <span className="text-gray-400"> &mdash; Round {pick.round_pick}</span>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-gray-600 italic">
                    Fight was locked before submission
                  </div>
                )}
                {fight.status === 'complete' && fight.result_winner && (
                  <div className="mt-2 text-xs text-gray-500">
                    Result:{' '}
                    <span className="text-white">{fight.result_winner}</span>
                    {' by '}
                    <span className="text-white">{fight.result_method}</span>
                    {fight.result_round != null && ` (Round ${fight.result_round})`}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Entry form ────────────────────────────────────────────────────────────
  const upcomingFights = fights.filter((f) => f.status === 'upcoming')
  const totalPotential = upcomingFights.reduce((sum, f) => sum + (calcPotential(f, picks[f.id])?.total ?? 0), 0)
  const pickedCount = upcomingFights.filter((f) => picks[f.id]?.winner_pick).length

  return (
    <div className={`max-w-3xl mx-auto px-4 py-8 ${totalPotential > 0 ? 'pb-28' : ''}`}>
      <div className="text-center mb-8">
        <h1 className="text-4xl font-black text-red-500 tracking-tight">UFC FIGHT NIGHT</h1>
        <h2 className="text-2xl font-bold text-white mt-1">PICK'EM</h2>
        <p className="text-gray-500 mt-2 text-sm">Submit your picks for tonight's fights</p>
      </div>

      {competitions.length === 0 ? (
        <div className="bg-gray-900 rounded-xl p-10 text-center text-gray-500">
          No prize pools are set up yet. Check back soon.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Player info */}
          <div className="bg-gray-900 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Your Info</h2>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Your full name"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-red-500 transition-colors"
              />
            </div>

            {/* Competition selector */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Choose Your Prize Pool
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {competitions.map((comp) => (
                  <label
                    key={comp.id}
                    className={`flex flex-col p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedCompetitionId === comp.id
                        ? 'border-red-500 bg-red-900/20'
                        : 'border-gray-700 hover:border-gray-500'
                    }`}
                  >
                    <input
                      type="radio"
                      name="competition"
                      value={comp.id}
                      checked={selectedCompetitionId === comp.id}
                      onChange={() => setSelectedCompetitionId(comp.id)}
                      className="sr-only"
                    />
                    <div className="flex items-baseline justify-between">
                      <span className="text-white font-bold text-lg">{comp.name}</span>
                      <span className="text-red-400 font-black text-xl">{comp.entry_fee}</span>
                    </div>
                    {comp.description && (
                      <span className="text-gray-400 text-sm mt-1">{comp.description}</span>
                    )}
                    {(comp.prize_splits ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2">
                        {(comp.prize_splits ?? []).map((s) => (
                          <span key={s.place} className="text-xs text-gray-500">
                            {s.place === 1 ? '1st' : s.place === 2 ? '2nd' : s.place === 3 ? '3rd' : `${s.place}th`}
                            {': '}<span className="text-green-400 font-semibold">{s.pct}%</span>
                          </span>
                        ))}
                        {(comp.expense_cut_pct ?? 0) > 0 && (
                          <span className="text-xs text-gray-600">· {comp.expense_cut_pct}% expense cut</span>
                        )}
                      </div>
                    )}
                  </label>
                ))}
              </div>
            </div>

          </div>

          {/* Fight picks */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white">Your Picks</h2>

            {fights.length === 0 && (
              <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-600">
                Fights not posted yet. Check back soon.
              </div>
            )}

            {fights.map((fight) => {
              const pick = picks[fight.id]
              const isLocked = fight.status === 'locked' || fight.status === 'complete'

              return (
                <div
                  key={fight.id}
                  className={`bg-gray-900 rounded-xl p-6 transition-opacity ${isLocked ? 'opacity-50' : ''}`}
                >
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-gray-500 text-xs font-semibold tracking-wider">
                      FIGHT {fight.fight_number} &bull; {fight.rounds} ROUNDS
                    </span>
                    <StatusBadge status={fight.status} />
                  </div>

                  <div className="mb-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Pick the Winner</p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { fighter: fight.fighter_a, odds: fight.odds_a },
                        { fighter: fight.fighter_b, odds: fight.odds_b },
                      ].map(({ fighter, odds }) => (
                        <label
                          key={fighter}
                          className={`flex flex-col items-center py-3 px-2 rounded-xl border-2 transition-all ${
                            isLocked ? 'cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            pick?.winner_pick === fighter
                              ? 'border-red-500 bg-red-900/30'
                              : 'border-gray-700 hover:border-gray-500'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`winner_${fight.id}`}
                            value={fighter}
                            checked={pick?.winner_pick === fighter}
                            onChange={() => !isLocked && updatePick(fight.id, 'winner_pick', fighter)}
                            disabled={isLocked}
                            className="sr-only"
                          />
                          <span className="text-white font-bold text-center text-sm leading-tight">
                            {fighter}
                          </span>
                          <span
                            className={`text-sm font-bold mt-1 ${odds > 0 ? 'text-green-400' : 'text-gray-400'}`}
                          >
                            {formatOdds(odds)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="mb-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Pick the Method</p>
                    <div className="grid grid-cols-3 gap-2">
                      {(['KO/TKO', 'Submission', 'Decision'] as Method[]).map((method) => (
                        <label
                          key={method}
                          className={`flex items-center justify-center py-2.5 px-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                            isLocked ? 'cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            pick?.method_pick === method
                              ? 'border-orange-500 bg-orange-900/30 text-white'
                              : 'border-gray-700 text-gray-500 hover:border-gray-500'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`method_${fight.id}`}
                            value={method}
                            checked={pick?.method_pick === method}
                            onChange={() => !isLocked && updatePick(fight.id, 'method_pick', method)}
                            disabled={isLocked}
                            className="sr-only"
                          />
                          {method}
                        </label>
                      ))}
                    </div>
                  </div>

                  {pick?.method_pick && pick.method_pick !== 'Decision' && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Pick the Round</p>
                      <input
                        type="number"
                        min={1}
                        max={fight.rounds}
                        value={pick.round_pick}
                        onChange={(e) =>
                          !isLocked && updatePick(fight.id, 'round_pick', e.target.value)
                        }
                        disabled={isLocked}
                        placeholder={`1 – ${fight.rounds}`}
                        className="w-32 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-orange-500 transition-colors"
                      />
                    </div>
                  )}

                  {/* Potential points breakdown */}
                  {!isLocked && (() => {
                    const p = calcPotential(fight, pick)
                    if (!p) return null
                    return (
                      <div className="mt-4 pt-3 border-t border-gray-800">
                        <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">Potential Points</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-sm">
                            <span className="text-gray-500">Winner</span>{' '}
                            <span className="text-green-400 font-bold">+{p.winner}</span>
                          </span>
                          {pick?.method_pick && (
                            <span className="text-sm text-gray-600">
                              + <span className="text-gray-400">Method</span>{' '}
                              <span className="text-blue-400 font-bold">+{p.method}</span>
                            </span>
                          )}
                          {pick?.method_pick && pick.method_pick !== 'Decision' && pick.round_pick && (
                            <span className="text-sm text-gray-600">
                              + <span className="text-gray-400">Round</span>{' '}
                              <span className="text-purple-400 font-bold">+{p.round}</span>
                            </span>
                          )}
                          <span className="ml-auto text-white font-black text-xl">+{p.total} pts</span>
                        </div>
                      </div>
                    )
                  })()}

                  {isLocked && (
                    <p className="mt-3 text-center text-xs font-bold text-yellow-500">
                      {fight.status === 'locked' ? 'PICKS LOCKED' : 'FIGHT COMPLETE'}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-white font-black text-xl py-4 rounded-xl transition-colors"
          >
            {submitting ? 'SUBMITTING...' : 'LOCK IN MY PICKS'}
          </button>
        </form>
      )}

      {/* Sticky running total */}
      {totalPotential > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-sm border-t border-gray-700 px-4 py-3 z-50">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-xs">{pickedCount} of {upcomingFights.length} fights picked</p>
              <p className="text-gray-400 text-sm font-medium">Max potential score</p>
            </div>
            <span className="text-green-400 font-black text-3xl">+{totalPotential}</span>
          </div>
        </div>
      )}
    </div>
  )
}
