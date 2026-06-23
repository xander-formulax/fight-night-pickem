'use client'

import { useEffect, useState, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatOdds } from '@/lib/scoring'
import type { Fight, Player, Pick } from '@/lib/types'

type Method = 'KO/TKO' | 'Submission' | 'Decision'

interface PickState {
  winner_pick: string
  method_pick: Method | ''
  round_pick: string
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
  const [fights, setFights] = useState<Fight[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [existingPlayer, setExistingPlayer] = useState<Player | null>(null)
  const [existingPicks, setExistingPicks] = useState<Pick[]>([])

  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [tier, setTier] = useState<'$25' | '$100'>('$25')
  const [tiebreaker, setTiebreaker] = useState('')
  const [picks, setPicks] = useState<Record<string, PickState>>({})
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    const supabase = getSupabaseBrowser()

    const { data: fightsData } = await supabase
      .from('fights')
      .select('*')
      .order('fight_number')

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

  useEffect(() => {
    loadData()
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

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
      setError('No open fights to submit picks for.')
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
      body: JSON.stringify({ name, contact, tier, tiebreaker, picks: picksToSubmit }),
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
        <div className="text-xl text-gray-400 animate-pulse">Loading fights...</div>
      </div>
    )
  }

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
            <p className="text-yellow-500 text-sm mt-1">Contact the organizer to complete your payment.</p>
          </div>
        ) : (
          <div className="bg-green-900/40 border border-green-600 rounded-xl p-5 mb-6 text-center">
            <p className="text-green-300 font-bold text-lg">Your entry is confirmed and activated!</p>
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
              <dt className="text-gray-500">Contact</dt>
              <dd className="text-white">{existingPlayer.contact}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Tier</dt>
              <dd className="text-white font-semibold">{existingPlayer.tier}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Tiebreaker</dt>
              <dd className="text-white">{existingPlayer.tiebreaker}</dd>
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
                  <div className="text-sm text-gray-600 italic">Fight was locked before submission</div>
                )}
                {fight.status === 'complete' && fight.result_winner && (
                  <div className="mt-2 text-xs text-gray-500">
                    Result: <span className="text-white">{fight.result_winner}</span>
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-black text-red-500 tracking-tight">UFC FIGHT NIGHT</h1>
        <h2 className="text-2xl font-bold text-white mt-1">PICK'EM</h2>
        <p className="text-gray-500 mt-2 text-sm">Submit your picks for tonight's fights</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
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

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Contact Info</label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
              placeholder="Phone number or email"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Entry Tier</label>
            <div className="grid grid-cols-2 gap-3">
              {(['$25', '$100'] as const).map((t) => (
                <label
                  key={t}
                  className={`flex items-center justify-center py-3 rounded-xl border-2 cursor-pointer transition-all font-black text-2xl ${
                    tier === t
                      ? 'border-red-500 bg-red-900/30 text-white'
                      : 'border-gray-700 text-gray-500 hover:border-gray-500'
                  }`}
                >
                  <input
                    type="radio"
                    name="tier"
                    value={t}
                    checked={tier === t}
                    onChange={() => setTier(t)}
                    className="sr-only"
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Tiebreaker</label>
            <p className="text-xs text-gray-600 mb-2">
              Total combined fight time for all 5 fights &mdash; format M:SS, e.g. 14:32
            </p>
            <input
              type="text"
              value={tiebreaker}
              onChange={(e) => setTiebreaker(e.target.value)}
              required
              placeholder="14:32"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">Your Picks</h2>

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
                          isLocked
                            ? 'cursor-not-allowed'
                            : 'cursor-pointer'
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
                          className={`text-sm font-bold mt-1 ${
                            odds > 0 ? 'text-green-400' : 'text-gray-400'
                          }`}
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
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                      Pick the Round
                    </p>
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
    </div>
  )
}
