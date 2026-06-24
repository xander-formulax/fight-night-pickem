'use client'

import { useEffect, useState, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatOdds } from '@/lib/scoring'
import type { Competition, Fight, Player, Pick, StoppageBet } from '@/lib/types'

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

  const [stoppageBets, setStoppageBets] = useState<StoppageBet[]>([])

  interface StoppageDraft {
    step: 'round' | 'minute' | 'second'
    round: number | null
    minute: number | null  // 1–5 (internal)
    second: number         // 0–59
    error: string
    placing: boolean
  }
  const [stoppageDrafts, setStoppageDrafts] = useState<Record<string, StoppageDraft>>({})

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

    // Load stoppage bets for all open fights
    const openFightIds = (fightsData ?? []).filter((f) => f.stoppage_bet_open).map((f) => f.id)
    if (openFightIds.length > 0) {
      const { data: betsData } = await supabase
        .from('stoppage_bets').select('*').in('fight_id', openFightIds)
      if (betsData) setStoppageBets(betsData)
    }

    setLoading(false)
  }, [])

  // Real-time updates so taken minutes refresh instantly for all players
  useEffect(() => {
    const supabase = getSupabaseBrowser()
    const channel = supabase
      .channel('stoppage-bets-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stoppage_bets' }, (payload) => {
        setStoppageBets((prev) => {
          if (prev.find((b) => b.id === (payload.new as StoppageBet).id)) return prev
          return [...prev, payload.new as StoppageBet]
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stoppage_bets' }, (payload) => {
        setStoppageBets((prev) =>
          prev.map((b) => (b.id === (payload.new as StoppageBet).id ? (payload.new as StoppageBet) : b))
        )
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    loadData()
    const interval = setInterval(() => loadData(), 15000)
    const onVisible = () => { if (document.visibilityState === 'visible') loadData() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [loadData])

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

  function updateDraft(fightId: string, update: Partial<StoppageDraft>) {
    const defaults: StoppageDraft = { step: 'round', round: null, minute: null, second: 0, error: '', placing: false }
    setStoppageDrafts((prev) => ({
      ...prev,
      [fightId]: { ...defaults, ...prev[fightId], ...update },
    }))
  }

  async function confirmStoppageBet(fightId: string) {
    if (!existingPlayer) return
    const draft = stoppageDrafts[fightId]
    if (!draft || draft.round == null || draft.minute == null) return
    updateDraft(fightId, { placing: true, error: '' })
    const res = await fetch('/api/stoppage-bet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fight_id: fightId,
        player_id: existingPlayer.id,
        round_pick: draft.round,
        minute_pick: draft.minute,
        second_pick: draft.second,
      }),
    })
    const result = await res.json()
    if (!res.ok) {
      updateDraft(fightId, { placing: false, error: result.error ?? 'Failed to place bet' })
    } else {
      setStoppageBets((prev) => [...prev.filter((b) => b.id !== result.bet.id), result.bet])
      // Reset draft — bet is now locked
      setStoppageDrafts((prev) => {
        const next = { ...prev }
        delete next[fightId]
        return next
      })
    }
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

        {/* ── Stoppage Time Jackpot ────────────────────────────────────── */}
        {(() => {
          const jackpotFights = fights.filter((f) => f.stoppage_bet_open && f.status !== 'complete')
          if (jackpotFights.length === 0) return null
          return (
            <div className="mb-6">
              <h3 className="text-lg font-bold text-white mb-1">Stoppage Time Jackpot</h3>
              <p className="text-gray-500 text-sm mb-1">
                Guess the exact moment the fight gets stopped — pick a round, minute, and second.
                The closest guess that <span className="text-white font-semibold">doesn&apos;t go over</span> wins the whole pot (Price Is Right rules).
              </p>
              <p className="text-gray-600 text-xs mb-4">
                If the fight goes to decision, the pot rolls over to the next jackpot fight. Each second can only be claimed by one person — picks are final once confirmed.
              </p>
              <div className="space-y-4">
                {jackpotFights.map((fight) => {
                  const fightBets = stoppageBets.filter((b) => b.fight_id === fight.id)
                  const myBet = fightBets.find((b) => b.player_id === existingPlayer.id)
                  const draft = stoppageDrafts[fight.id] ?? { step: 'round' as const, round: null, minute: null, second: 0, error: '', placing: false }
                  const fee = fight.stoppage_bet_fee ?? '20'
                  const feeNum = parseFloat(fee) || 20
                  const activatedCount = fightBets.filter((b) => b.activated).length
                  const rollover = fight.jackpot_rollover ?? 0
                  const potTotal = activatedCount * feeNum + rollover

                  const takenInMinute = (r: number, m: number) =>
                    fightBets.filter((b) => b.round_pick === r && b.minute_pick === m).length

                  return (
                    <div key={fight.id} className="bg-gray-900 rounded-xl p-5 border border-yellow-900/40">
                      {/* Header */}
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <p className="text-xs text-yellow-500 font-bold uppercase tracking-wider mb-0.5">
                            Fight {fight.fight_number} — Jackpot
                          </p>
                          <p className="text-white font-bold">
                            {fight.fighter_a} vs {fight.fighter_b}
                          </p>
                          {rollover > 0 && (
                            <p className="text-xs text-orange-400 mt-1 font-semibold">
                              🔥 Includes ${rollover} rollover from previous fight
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          {potTotal > 0 ? (
                            <>
                              <p className="text-yellow-400 font-black text-xl">${potTotal}</p>
                              <p className="text-xs text-gray-500">current pot</p>
                              <p className="text-xs text-gray-600">${fee} entry</p>
                            </>
                          ) : (
                            <>
                              <p className="text-yellow-400 font-black text-xl">${fee}</p>
                              <p className="text-xs text-gray-500">entry fee</p>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Locked pick display */}
                      {myBet ? (
                        <div className="bg-yellow-900/25 border border-yellow-700/50 rounded-xl px-4 py-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-yellow-600 uppercase tracking-wider mb-0.5">Your Pick — Locked</p>
                              <p className="text-yellow-300 font-black text-lg">
                                Round {myBet.round_pick} &bull; {myBet.minute_pick - 1}:{myBet.second_pick.toString().padStart(2, '0')}
                              </p>
                            </div>
                            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${myBet.activated ? 'bg-green-900 text-green-300' : 'bg-orange-900/60 text-orange-300'}`}>
                              {myBet.activated ? 'Confirmed' : 'Awaiting Payment'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 mt-2 italic">Pick is final and cannot be changed.</p>
                        </div>
                      ) : (
                        <>
                          {/* Step 1: Select Round */}
                          {draft.step === 'round' && (
                            <div>
                              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Step 1 — Select a Round</p>
                              <div className="flex gap-2 flex-wrap">
                                {Array.from({ length: fight.rounds ?? 3 }, (_, i) => i + 1).map((r) => (
                                  <button
                                    key={r}
                                    onClick={() => updateDraft(fight.id, { step: 'minute', round: r })}
                                    className="px-5 py-3 rounded-xl border-2 border-gray-700 text-white font-bold hover:border-yellow-600 hover:bg-yellow-900/20 transition-all"
                                  >
                                    Round {r}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Step 2: Select Minute within round */}
                          {draft.step === 'minute' && draft.round != null && (
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <button onClick={() => updateDraft(fight.id, { step: 'round', round: null, minute: null })} className="text-gray-500 hover:text-gray-300 text-sm">← Back</button>
                                <p className="text-xs text-gray-500 uppercase tracking-wider">Round {draft.round} — Select a Minute</p>
                              </div>
                              <div className="flex gap-2 flex-wrap">
                                {[0, 1, 2, 3, 4].map((clockMin) => {
                                  const minutePick = clockMin + 1
                                  const taken = takenInMinute(draft.round!, minutePick)
                                  const full = taken >= 60
                                  return (
                                    <button
                                      key={clockMin}
                                      onClick={() => !full && updateDraft(fight.id, { step: 'second', minute: minutePick, second: 0 })}
                                      disabled={full}
                                      className={`px-4 py-3 rounded-xl border-2 font-bold transition-all ${
                                        full
                                          ? 'border-gray-800 text-gray-700 cursor-not-allowed'
                                          : 'border-gray-700 text-white hover:border-yellow-600 hover:bg-yellow-900/20'
                                      }`}
                                    >
                                      <span className="text-base">{clockMin}:__</span>
                                      {taken > 0 && <span className="block text-xs text-gray-500 font-normal">{taken}/60 taken</span>}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {/* Step 3: Second slider + Confirm */}
                          {draft.step === 'second' && draft.round != null && draft.minute != null && (
                            <div>
                              <div className="flex items-center gap-2 mb-4">
                                <button onClick={() => updateDraft(fight.id, { step: 'minute', minute: null, second: 0 })} className="text-gray-500 hover:text-gray-300 text-sm">← Back</button>
                                <p className="text-xs text-gray-500 uppercase tracking-wider">Round {draft.round}, Minute {draft.minute - 1}:__ — Pick your second</p>
                              </div>

                              <div className="text-center mb-4">
                                <p className="text-5xl font-black text-yellow-400 tabular-nums">
                                  {draft.minute - 1}:{draft.second.toString().padStart(2, '0')}
                                </p>
                                <p className="text-gray-500 text-sm mt-1">Round {draft.round}</p>
                              </div>

                              <input
                                type="range"
                                min={0}
                                max={59}
                                value={draft.second}
                                onChange={(e) => updateDraft(fight.id, { second: parseInt(e.target.value) })}
                                className="w-full accent-yellow-500 mb-4"
                              />
                              <div className="flex justify-between text-xs text-gray-600 mb-5">
                                <span>:00</span><span>:15</span><span>:30</span><span>:45</span><span>:59</span>
                              </div>

                              <button
                                onClick={() => confirmStoppageBet(fight.id)}
                                disabled={draft.placing}
                                className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-black py-3 rounded-xl transition-colors"
                              >
                                {draft.placing ? 'Checking…' : `Confirm Pick — R${draft.round} ${draft.minute - 1}:${draft.second.toString().padStart(2, '0')}`}
                              </button>
                              <p className="text-xs text-gray-600 text-center mt-2 italic">Picks are final and cannot be changed after confirming.</p>
                            </div>
                          )}

                          {draft.error && (
                            <p className="text-red-400 text-sm mt-3">{draft.error}</p>
                          )}

                          {draft.step === 'round' && (
                            <p className="text-xs text-gray-600 mt-3 italic">
                              After locking in, contact the organizer to pay ${fee}.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

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
                      <div className="flex gap-2 flex-wrap">
                        {Array.from({ length: fight.rounds }, (_, i) => i + 1).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => !isLocked && updatePick(fight.id, 'round_pick', String(r))}
                            disabled={isLocked}
                            className={`w-12 h-10 rounded-xl border-2 text-sm font-bold transition-all ${
                              pick?.round_pick === String(r)
                                ? 'border-purple-500 bg-purple-900/30 text-white'
                                : 'border-gray-700 text-gray-500 hover:border-gray-500'
                            } ${isLocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                          >
                            R{r}
                          </button>
                        ))}
                      </div>
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
