'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatOdds } from '@/lib/scoring'
import type { Competition, Fight, Player, Pick, StoppageBet } from '@/lib/types'

function PlayerTabs() {
  return (
    <div className="flex gap-1 bg-gray-900/80 rounded-xl p-1 mb-6">
      <span className="flex-1 py-2.5 rounded-lg text-sm font-bold text-center bg-white text-black">My Picks</span>
      <Link href="/leaderboard" className="flex-1 py-2.5 rounded-lg text-sm font-bold text-center text-gray-300 hover:text-white transition-colors">Leaderboard</Link>
    </div>
  )
}

type Method = 'KO/TKO' | 'Submission' | 'Decision'

interface PickState {
  winner_pick: string
  method_pick: Method | ''
  round_pick: string
}

interface StoredEntry {
  id: string
  competition_id: string
  entry_number: number
  name: string
}

function winnerPts(odds: number): number {
  if (odds > 0) return odds
  if (odds < 0) return Math.round((100 / Math.abs(odds)) * 100)
  return 100
}

const METHOD_PTS: Record<string, number> = { 'KO/TKO': 100, Submission: 150, Decision: 50 }

const METHOD_META: { value: Method; label: string; icon: string }[] = [
  { value: 'KO/TKO', label: 'KO/TKO', icon: '👊' },
  { value: 'Submission', label: 'Sub', icon: '🔒' },
  { value: 'Decision', label: 'Decision', icon: '📋' },
]

function isPickComplete(pick: PickState | undefined): boolean {
  if (!pick?.winner_pick) return false
  if (!pick.method_pick) return false
  if (pick.method_pick !== 'Decision' && !pick.round_pick) return false
  return true
}

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

function getStoredEntries(): StoredEntry[] {
  if (typeof window === 'undefined') return []
  const raw = localStorage.getItem('fight_night_entries')
  if (raw) {
    try { return JSON.parse(raw) } catch { return [] }
  }
  // Migrate legacy single-player key
  const legacyId = localStorage.getItem('fight_night_player_id')
  if (legacyId) {
    return [{ id: legacyId, competition_id: '', entry_number: 1, name: '' }]
  }
  return []
}

function saveStoredEntries(entries: StoredEntry[]) {
  localStorage.setItem('fight_night_entries', JSON.stringify(entries))
}

export default function PlayPage() {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [fights, setFights] = useState<Fight[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [eventTitle, setEventTitle] = useState('')
  const [eventPhase, setEventPhase] = useState<'setup' | 'open' | 'live'>('setup')
  const [jackpotEnabled, setJackpotEnabled] = useState(false)
  const [jackpotFee, setJackpotFee] = useState('20')

  // Multi-entry state
  const [storedEntries, setStoredEntries] = useState<StoredEntry[]>([])
  const [activeEntryIdx, setActiveEntryIdx] = useState(0)
  const [viewingPlayer, setViewingPlayer] = useState<Player | null>(null)
  const [viewingPicks, setViewingPicks] = useState<Pick[]>([])
  const [isAddingEntry, setIsAddingEntry] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [selectedCompetitionId, setSelectedCompetitionId] = useState('')
  const [picks, setPicks] = useState<Record<string, PickState>>({})
  const [error, setError] = useState('')

  // Wizard flow state
  const [flowStep, setFlowStep] = useState<'setup' | number | 'review'>('setup')
  const [showConfirmSheet, setShowConfirmSheet] = useState(false)

  const [stoppageBets, setStoppageBets] = useState<StoppageBet[]>([])

  interface StoppageDraft {
    step: 'round' | 'minute' | 'second'
    round: number | null
    minute: number | null
    second: number
    error: string
    placing: boolean
  }
  const [stoppageDrafts, setStoppageDrafts] = useState<Record<string, StoppageDraft>>({})

  const loadEntryData = useCallback(async (entry: StoredEntry) => {
    const supabase = getSupabaseBrowser()
    // Resolve competition_id from DB if the legacy entry didn't store it
    const { data: playerData } = await supabase
      .from('players').select('*').eq('id', entry.id).single()
    if (playerData) {
      setViewingPlayer(playerData)
      // Patch stored entry with name/competition_id if migrating from legacy
      if (!entry.competition_id || !entry.name) {
        setStoredEntries((prev) => {
          const updated = prev.map((e) =>
            e.id === entry.id
              ? { ...e, competition_id: playerData.competition_id ?? '', name: playerData.name, entry_number: playerData.entry_number ?? 1 }
              : e
          )
          saveStoredEntries(updated)
          return updated
        })
      }
      const { data: picksData } = await supabase
        .from('picks').select('*').eq('player_id', entry.id)
      if (picksData) setViewingPicks(picksData)
    } else {
      // Entry no longer valid (e.g., reset)
      setStoredEntries((prev) => {
        const updated = prev.filter((e) => e.id !== entry.id)
        saveStoredEntries(updated)
        return updated
      })
      setViewingPlayer(null)
      setViewingPicks([])
    }
  }, [])

  const loadData = useCallback(async () => {
    const supabase = getSupabaseBrowser()

    const [{ data: compsData }, { data: fightsData }, settingsRes] = await Promise.all([
      supabase.from('competitions').select('*').order('created_at'),
      supabase.from('fights').select('*').order('fight_number'),
      fetch('/api/event-settings'),
    ])

    if (settingsRes.ok) {
      const settings = await settingsRes.json()
      if (settings.event_title) setEventTitle(settings.event_title)
      setEventPhase((settings.event_phase as 'setup' | 'open' | 'live') ?? 'setup')
      setJackpotEnabled(Boolean(settings.jackpot_enabled))
      setJackpotFee(String(settings.jackpot_fee ?? '20'))
    }

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

    const entries = getStoredEntries()
    setStoredEntries(entries)

    if (entries.length > 0) {
      const activeEntry = entries[0]
      await loadEntryData(activeEntry)
    }

    // Load stoppage bets for open fights
    const openFightIds = (fightsData ?? []).filter((f) => f.stoppage_bet_open).map((f) => f.id)
    if (openFightIds.length > 0) {
      const { data: betsData } = await supabase
        .from('stoppage_bets').select('*').in('fight_id', openFightIds)
      if (betsData) setStoppageBets(betsData)
    }

    setLoading(false)
  }, [loadEntryData])

  // Reload player data when switching entries
  useEffect(() => {
    if (storedEntries.length > 0 && storedEntries[activeEntryIdx]) {
      loadEntryData(storedEntries[activeEntryIdx])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntryIdx])

  // Real-time stoppage bet updates
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

  function resetPicksToEmpty(fightList: Fight[]) {
    const next: Record<string, PickState> = {}
    fightList.forEach((f) => { next[f.id] = { winner_pick: '', method_pick: '', round_pick: '' } })
    setPicks(next)
  }

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
    if (!viewingPlayer) return
    const draft = stoppageDrafts[fightId]
    if (!draft || draft.round == null || draft.minute == null) return
    updateDraft(fightId, { placing: true, error: '' })
    const res = await fetch('/api/stoppage-bet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fight_id: fightId,
        player_id: viewingPlayer.id,
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
      setStoppageDrafts((prev) => {
        const next = { ...prev }
        delete next[fightId]
        return next
      })
    }
  }

  async function handleSubmit() {
    setError('')

    if (!selectedCompetitionId) {
      setError('Please select a prize pool to enter.')
      setShowConfirmSheet(false)
      return
    }

    const upcomingFights = fights.filter((f) => f.status === 'upcoming')

    for (let i = 0; i < upcomingFights.length; i++) {
      const fight = upcomingFights[i]
      if (!isPickComplete(picks[fight.id])) {
        setError(`Finish your picks for Fight ${fight.fight_number}: ${fight.fighter_a} vs ${fight.fighter_b}`)
        setShowConfirmSheet(false)
        setFlowStep(i)
        return
      }
    }

    if (upcomingFights.length === 0) {
      setError('No open fights available for picks.')
      setShowConfirmSheet(false)
      return
    }

    setSubmitting(true)

    const existingEntriesForComp = storedEntries.filter((e) => e.competition_id === selectedCompetitionId)
    const entryNumber = existingEntriesForComp.length + 1

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
        entry_number: entryNumber,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      setError(result.error ?? 'Failed to submit picks. Please try again.')
      setSubmitting(false)
      setShowConfirmSheet(false)
      return
    }

    const newEntry: StoredEntry = {
      id: result.player_id,
      competition_id: selectedCompetitionId,
      entry_number: entryNumber,
      name,
    }
    const updatedEntries = [...storedEntries, newEntry]
    saveStoredEntries(updatedEntries)
    setStoredEntries(updatedEntries)
    setActiveEntryIdx(updatedEntries.length - 1)
    setIsAddingEntry(false)
    setShowConfirmSheet(false)
    setFlowStep('setup')
    setSubmitting(false)
    await loadEntryData(newEntry)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-400 animate-pulse">Loading...</div>
      </div>
    )
  }

  // ── Confirmed / multi-entry view ──────────────────────────────────────────
  if (storedEntries.length > 0 && !isAddingEntry) {
    const activeEntry = storedEntries[activeEntryIdx] ?? storedEntries[0]
    const selectedComp = competitions.find((c) => c.id === viewingPlayer?.competition_id)

    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <PlayerTabs />
        <div className="text-center mb-6">
          <h1 className="text-4xl font-black text-red-500 tracking-tight">{eventTitle || 'UFC FIGHT NIGHT'}</h1>
          <h2 className="text-2xl font-bold text-white mt-1">PICK'EM</h2>
        </div>

        {/* Entry tabs — shown when player has multiple entries */}
        {storedEntries.length > 1 && (
          <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
            {storedEntries.map((entry, idx) => {
              const comp = competitions.find((c) => c.id === entry.competition_id)
              return (
                <button
                  key={entry.id}
                  onClick={() => setActiveEntryIdx(idx)}
                  className={`shrink-0 px-4 py-2 rounded-xl font-bold text-sm transition-colors ${
                    idx === activeEntryIdx
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-800/70 text-gray-300 hover:text-white'
                  }`}
                >
                  {comp?.name ?? 'Entry'} #{entry.entry_number}
                </button>
              )
            })}
          </div>
        )}

        {/* Entry purchase cards — same big tiles as the opening screen, with purchase counts */}
        {eventPhase === 'open' && competitions.some((c) => (c.max_entries ?? 1) > 1) && (
          <div className="mb-6">
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Entries</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {competitions.map((comp) => {
                const used = storedEntries.filter((e) => e.competition_id === comp.id).length
                const max = comp.max_entries ?? 1
                const isMaxed = used >= max
                return (
                  <button
                    key={comp.id}
                    type="button"
                    disabled={isMaxed}
                    onClick={() => {
                      setName(viewingPlayer?.name ?? '')
                      setSelectedCompetitionId(comp.id)
                      resetPicksToEmpty(fights)
                      setError('')
                      setFlowStep(fights.some((f) => f.status === 'upcoming') ? 0 : 'review')
                      setIsAddingEntry(true)
                    }}
                    className={`relative flex flex-col items-start text-left p-6 rounded-2xl border-2 transition-all ${
                      isMaxed
                        ? 'border-gray-800 opacity-40 cursor-not-allowed'
                        : 'border-gray-700 hover:border-red-500 hover:bg-red-900/10'
                    }`}
                  >
                    {!isMaxed && (
                      <span className="absolute top-4 right-4 w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center text-xl leading-none">+</span>
                    )}
                    <span className="text-red-400 font-black text-3xl">{comp.entry_fee}</span>
                    <span className="text-white font-bold text-lg mt-1">{comp.name}</span>
                    {comp.description && <span className="text-gray-400 text-sm mt-1">{comp.description}</span>}
                    <span className={`text-xs mt-2 font-semibold ${isMaxed ? 'text-gray-500' : 'text-blue-400'}`}>
                      {used} of {max} {max === 1 ? 'entry' : 'entries'} purchased
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {!viewingPlayer ? (
          <div className="text-center text-gray-400 py-8 animate-pulse">Loading entry…</div>
        ) : (
          <>
            {!viewingPlayer.activated ? (
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

            <div className="bg-gray-900/70 backdrop-blur-sm rounded-xl p-6 mb-6">
              <h3 className="text-lg font-bold text-white mb-3">Your Entry Details</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-gray-300">Name</dt>
                  <dd className="text-white font-semibold">{viewingPlayer.name}</dd>
                </div>
                <div>
                  <dt className="text-gray-300">Prize Pool</dt>
                  <dd className="text-white font-semibold">
                    {selectedComp ? `${selectedComp.name} (${selectedComp.entry_fee})` : viewingPlayer.tier}
                  </dd>
                </div>
                {storedEntries.length > 1 && (
                  <div>
                    <dt className="text-gray-300">Entry</dt>
                    <dd className="text-white font-semibold">#{activeEntry.entry_number}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* ── Stoppage Time Jackpot ────────────────────────────────── */}
            {(() => {
              const jackpotFights = jackpotEnabled ? fights.filter((f) => f.stoppage_bet_open && f.status !== 'complete') : []
              if (jackpotFights.length === 0) return null
              return (
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-white mb-1">Stoppage Time Jackpot</h3>
                  <p className="text-gray-300 text-sm mb-1">
                    Guess the exact moment the fight gets stopped — pick a round, minute, and second.
                    The closest guess that <span className="text-white font-semibold">doesn&apos;t go over</span> wins the whole pot (Price Is Right rules).
                  </p>
                  <p className="text-gray-400 text-xs mb-4">
                    If the fight goes to decision, the pot rolls over to the next jackpot fight. Each second can only be claimed by one person — picks are final once confirmed.
                  </p>
                  <div className="space-y-4">
                    {jackpotFights.map((fight) => {
                      const fightBets = stoppageBets.filter((b) => b.fight_id === fight.id)
                      const myBet = fightBets.find((b) => b.player_id === viewingPlayer.id)
                      const draft = stoppageDrafts[fight.id] ?? { step: 'round' as const, round: null, minute: null, second: 0, error: '', placing: false }
                      const fee = fight.stoppage_bet_fee ?? jackpotFee
                      const feeNum = parseFloat(fee) || 20
                      const activatedCount = fightBets.filter((b) => b.activated).length
                      const rollover = fight.jackpot_rollover ?? 0
                      const potTotal = activatedCount * feeNum + rollover

                      const takenInMinute = (r: number, m: number) =>
                        fightBets.filter((b) => b.round_pick === r && b.minute_pick === m).length

                      return (
                        <div key={fight.id} className={`bg-gray-900/70 backdrop-blur-sm rounded-xl p-5 border ${rollover > 0 ? 'border-orange-500/70 shadow-[0_0_25px_-5px_rgba(249,115,22,0.5)]' : 'border-yellow-900/40'}`}>
                          {/* Rollover excitement banner */}
                          {rollover > 0 && (
                            <div className="-mx-5 -mt-5 mb-4 px-5 py-3 bg-gradient-to-r from-orange-600 via-red-600 to-orange-600 rounded-t-xl text-center animate-pulse">
                              <p className="text-white font-black text-lg tracking-tight drop-shadow">
                                🔥 ${rollover} ROLLOVER JACKPOT! 🔥
                              </p>
                              <p className="text-orange-100 text-xs font-semibold">Nobody won last fight — it&apos;s all up for grabs now!</p>
                            </div>
                          )}
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <p className="text-xs text-yellow-500 font-bold uppercase tracking-wider mb-0.5">
                                Fight {fight.fight_number} — Jackpot
                              </p>
                              <p className="text-white font-bold">
                                {fight.fighter_a} vs {fight.fighter_b}
                              </p>
                            </div>
                            <div className="text-right">
                              {potTotal > 0 ? (
                                <>
                                  <p className="text-yellow-400 font-black text-xl">${potTotal}</p>
                                  <p className="text-xs text-gray-300">current pot</p>
                                  <p className="text-xs text-gray-400">${fee} entry</p>
                                </>
                              ) : (
                                <>
                                  <p className="text-yellow-400 font-black text-xl">${fee}</p>
                                  <p className="text-xs text-gray-300">entry fee</p>
                                </>
                              )}
                            </div>
                          </div>

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
                              <p className="text-xs text-gray-400 mt-2 italic">Pick is final and cannot be changed.</p>
                            </div>
                          ) : (
                            <>
                              {draft.step === 'round' && (
                                <div>
                                  <p className="text-xs text-gray-300 uppercase tracking-wider mb-2">Step 1 — Select a Round</p>
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

                              {draft.step === 'minute' && draft.round != null && (
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <button onClick={() => updateDraft(fight.id, { step: 'round', round: null, minute: null })} className="text-gray-300 hover:text-gray-300 text-sm">← Back</button>
                                    <p className="text-xs text-gray-300 uppercase tracking-wider">Round {draft.round} — Select a Minute</p>
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
                                              ? 'border-gray-800 text-gray-400 cursor-not-allowed'
                                              : 'border-gray-700 text-white hover:border-yellow-600 hover:bg-yellow-900/20'
                                          }`}
                                        >
                                          <span className="text-base">{clockMin}:__</span>
                                          {taken > 0 && <span className="block text-xs text-gray-300 font-normal">{taken}/60 taken</span>}
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}

                              {draft.step === 'second' && draft.round != null && draft.minute != null && (
                                <div>
                                  <div className="flex items-center gap-2 mb-4">
                                    <button onClick={() => updateDraft(fight.id, { step: 'minute', minute: null, second: 0 })} className="text-gray-300 hover:text-gray-300 text-sm">← Back</button>
                                    <p className="text-xs text-gray-300 uppercase tracking-wider">Round {draft.round}, Minute {draft.minute - 1}:__ — Pick your second</p>
                                  </div>
                                  <div className="text-center mb-4">
                                    <p className="text-5xl font-black text-yellow-400 tabular-nums">
                                      {draft.minute - 1}:{draft.second.toString().padStart(2, '0')}
                                    </p>
                                    <p className="text-gray-300 text-sm mt-1">Round {draft.round}</p>
                                  </div>
                                  <input
                                    type="range" min={0} max={59} value={draft.second}
                                    onChange={(e) => updateDraft(fight.id, { second: parseInt(e.target.value) })}
                                    className="w-full accent-yellow-500 mb-4"
                                  />
                                  <div className="flex justify-between text-xs text-gray-400 mb-5">
                                    <span>:00</span><span>:15</span><span>:30</span><span>:45</span><span>:59</span>
                                  </div>
                                  <button
                                    onClick={() => confirmStoppageBet(fight.id)}
                                    disabled={draft.placing}
                                    className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:text-gray-300 text-black font-black py-3 rounded-xl transition-colors"
                                  >
                                    {draft.placing ? 'Checking…' : `Confirm Pick — R${draft.round} ${draft.minute - 1}:${draft.second.toString().padStart(2, '0')}`}
                                  </button>
                                  <p className="text-xs text-gray-400 text-center mt-2 italic">Picks are final and cannot be changed after confirming.</p>
                                </div>
                              )}

                              {draft.error && (
                                <p className="text-red-400 text-sm mt-3">{draft.error}</p>
                              )}

                              {draft.step === 'round' && (
                                <p className="text-xs text-gray-400 mt-3 italic">
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
                const pick = viewingPicks.find((p) => p.fight_id === fight.id)
                return (
                  <div key={fight.id} className="bg-gray-900/70 backdrop-blur-sm rounded-xl p-4">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-gray-300 text-xs font-medium">FIGHT {fight.fight_number}</span>
                      <StatusBadge status={fight.status} />
                    </div>
                    <div className="text-white font-semibold mb-1">
                      {fight.fighter_a} vs {fight.fighter_b}
                    </div>
                    {pick ? (
                      <div className="text-sm">
                        <span className="text-red-400 font-bold">{pick.winner_pick}</span>
                        <span className="text-gray-300 mx-1">by</span>
                        <span className="text-orange-400">{pick.method_pick}</span>
                        {pick.round_pick != null && (
                          <span className="text-gray-400"> &mdash; Round {pick.round_pick}</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 italic">
                        Fight was locked before submission
                      </div>
                    )}
                    {fight.status === 'complete' && fight.result_winner && (
                      <div className="mt-2 text-xs text-gray-300">
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

          </>
        )}
      </div>
    )
  }

  // Brand-new players can only enter while pick'em is open
  if (storedEntries.length === 0 && eventPhase !== 'open') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <PlayerTabs />
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black text-red-500 tracking-tight">{eventTitle || 'UFC FIGHT NIGHT'}</h1>
          <h2 className="text-2xl font-bold text-white mt-1">PICK'EM</h2>
        </div>
        <div className="bg-gray-900/70 backdrop-blur-sm rounded-2xl p-10 text-center">
          {eventPhase === 'setup' ? (
            <>
              <p className="text-white font-bold text-lg">Picks aren&apos;t open yet</p>
              <p className="text-gray-300 text-sm mt-2">Hang tight — the organizer will open entries soon. Check back in a bit!</p>
            </>
          ) : (
            <>
              <p className="text-white font-bold text-lg">Picks are closed</p>
              <p className="text-gray-300 text-sm mt-2">The event has started. Follow the action on the <Link href="/leaderboard" className="text-red-400 font-semibold underline">leaderboard</Link>.</p>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Entry form (wizard) ─────────────────────────────────────────────────────
  const upcomingFights = fights.filter((f) => f.status === 'upcoming')
  const wizComp = competitions.find((c) => c.id === selectedCompetitionId)
  const wizEntryNum = storedEntries.filter((e) => e.competition_id === selectedCompetitionId).length + 1

  function cancelAdd() {
    setIsAddingEntry(false)
    setFlowStep('setup')
    setActiveEntryIdx(Math.max(0, storedEntries.length - 1))
  }
  function startPicks() {
    setError('')
    if (!name.trim()) { setError('Please enter your name.'); return }
    if (!selectedCompetitionId) { setError('Please choose a prize pool.'); return }
    setFlowStep(upcomingFights.length > 0 ? 0 : 'review')
  }
  function nextFromFight(i: number) {
    setError('')
    setFlowStep(i < upcomingFights.length - 1 ? i + 1 : 'review')
  }
  function backFromFight(i: number) {
    setError('')
    if (i > 0) setFlowStep(i - 1)
    else if (isAddingEntry) cancelAdd()
    else setFlowStep('setup')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-32">
      <PlayerTabs />
      <div className="text-center mb-6">
        <h1 className="text-4xl font-black text-red-500 tracking-tight">{eventTitle || 'UFC FIGHT NIGHT'}</h1>
        <h2 className="text-2xl font-bold text-white mt-1">PICK'EM</h2>
        {isAddingEntry && (
          <p className="text-gray-300 mt-2 text-sm">
            Adding entry #{wizEntryNum} for{' '}
            <span className="text-white font-semibold">{wizComp?.name}</span>
          </p>
        )}
      </div>

      {competitions.length === 0 ? (
        <div className="bg-gray-900/70 backdrop-blur-sm rounded-xl p-10 text-center text-gray-300">
          No prize pools are set up yet. Check back soon.
        </div>
      ) : (
        <div className="space-y-6">
          {/* STEP: setup — name + tier cards */}
          {flowStep === 'setup' && (
            <>
              <div className="bg-gray-900/70 backdrop-blur-sm rounded-2xl p-6">
                <label className="block text-sm font-bold text-gray-200 mb-2">Your Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full bg-gray-800/70 border-2 border-gray-700/80 rounded-xl px-4 py-3.5 text-white text-lg placeholder-gray-500 focus:outline-none focus:border-red-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {competitions.map((comp) => {
                  const used = storedEntries.filter((e) => e.competition_id === comp.id).length
                  const maxEntries = comp.max_entries ?? 1
                  const isMaxed = used >= maxEntries
                  const selected = selectedCompetitionId === comp.id
                  return (
                    <button
                      key={comp.id}
                      type="button"
                      disabled={isMaxed}
                      onClick={() => setSelectedCompetitionId(comp.id)}
                      className={`relative flex flex-col items-start text-left p-6 rounded-2xl border-2 transition-all ${
                        isMaxed
                          ? 'border-gray-800 opacity-40 cursor-not-allowed'
                          : selected
                          ? 'border-red-500 bg-red-900/30'
                          : 'border-gray-700 hover:border-gray-500'
                      }`}
                    >
                      {selected && (
                        <span className="absolute top-4 right-4 w-7 h-7 rounded-full bg-red-500 text-white flex items-center justify-center text-base">✓</span>
                      )}
                      <span className="text-red-400 font-black text-3xl">{comp.entry_fee}</span>
                      <span className="text-white font-bold text-lg mt-1">{comp.name}</span>
                      {comp.description && <span className="text-gray-400 text-sm mt-1">{comp.description}</span>}
                      {maxEntries > 1 && (
                        <span className={`text-xs mt-2 font-semibold ${isMaxed ? 'text-gray-500' : 'text-blue-400'}`}>
                          {isMaxed ? 'Max entries reached' : `Entry #${used + 1} of ${maxEntries}`}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {error && <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>}

              <button
                type="button"
                onClick={startPicks}
                disabled={!name.trim() || !selectedCompetitionId}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-black text-xl py-4 rounded-2xl transition-colors"
              >
                Start Picks →
              </button>
            </>
          )}

          {/* STEP: per-fight pick */}
          {typeof flowStep === 'number' && upcomingFights[flowStep] && (() => {
            const idx = flowStep
            const fight = upcomingFights[idx]
            const pick = picks[fight.id]
            const complete = isPickComplete(pick)
            const winnerChosen = Boolean(pick?.winner_pick)
            const showRound = pick?.method_pick && pick.method_pick !== 'Decision'
            const pot = calcPotential(fight, pick)
            return (
              <div className="space-y-5">
                {/* progress */}
                <div>
                  <div className="flex items-center justify-center gap-1.5 mb-2">
                    {upcomingFights.map((f, i) => (
                      <span key={f.id} className={`h-1.5 rounded-full transition-all ${
                        i === idx ? 'w-6 bg-red-500' : isPickComplete(picks[f.id]) ? 'w-1.5 bg-green-500' : 'w-1.5 bg-gray-600'
                      }`} />
                    ))}
                  </div>
                  <p className="text-center text-gray-400 text-xs font-semibold uppercase tracking-wider">
                    Fight {idx + 1} of {upcomingFights.length} · {fight.rounds} rounds
                  </p>
                </div>

                {/* winner cards (stacked) */}
                <div className="space-y-3">
                  <p className="text-sm font-bold text-gray-300 text-center uppercase tracking-wide">Who will win?</p>
                  {[
                    { fighter: fight.fighter_a, odds: fight.odds_a },
                    { fighter: fight.fighter_b, odds: fight.odds_b },
                  ].map(({ fighter, odds }) => {
                    const sel = pick?.winner_pick === fighter
                    const dim = winnerChosen && !sel
                    return (
                      <button
                        key={fighter}
                        type="button"
                        onClick={() => updatePick(fight.id, 'winner_pick', fighter)}
                        className={`w-full flex items-center justify-between px-6 py-6 rounded-2xl border-2 transition-all ${
                          sel ? 'border-red-500 bg-red-900/30' : dim ? 'border-gray-800 opacity-50' : 'border-gray-700 hover:border-gray-500'
                        }`}
                      >
                        <div className="text-left">
                          <div className="text-white font-black text-2xl leading-tight">{fighter}</div>
                          <div className={`text-sm font-bold mt-1 ${odds > 0 ? 'text-green-400' : 'text-gray-400'}`}>{formatOdds(odds)}</div>
                        </div>
                        <span className={`w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 text-lg ${sel ? 'border-red-500 bg-red-500 text-white' : 'border-gray-600 text-transparent'}`}>✓</span>
                      </button>
                    )
                  })}
                </div>

                {/* method (after winner) */}
                {winnerChosen && (
                  <div className="space-y-2">
                    <p className="text-sm font-bold text-gray-300 text-center uppercase tracking-wide">Winning method?</p>
                    <div className="grid grid-cols-3 gap-3">
                    {METHOD_META.map(({ value, label, icon }) => {
                      const sel = pick?.method_pick === value
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updatePick(fight.id, 'method_pick', value)}
                          className={`flex flex-col items-center gap-1.5 py-4 rounded-2xl border-2 transition-all ${
                            sel ? 'border-orange-500 bg-orange-900/30' : 'border-gray-700 hover:border-gray-500'
                          }`}
                        >
                          <span className="text-3xl leading-none">{icon}</span>
                          <span className={`text-sm font-bold ${sel ? 'text-white' : 'text-gray-300'}`}>{label}</span>
                        </button>
                      )
                    })}
                    </div>
                  </div>
                )}

                {/* round (after KO/Sub) */}
                {showRound && (
                  <div className="space-y-2">
                    <p className="text-sm font-bold text-gray-300 text-center uppercase tracking-wide">In which round?</p>
                    <div className="flex gap-3 flex-wrap justify-center">
                    {Array.from({ length: fight.rounds }, (_, i) => i + 1).map((r) => {
                      const sel = pick?.round_pick === String(r)
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => updatePick(fight.id, 'round_pick', String(r))}
                          className={`w-14 h-14 rounded-2xl border-2 text-xl font-black transition-all ${
                            sel ? 'border-purple-500 bg-purple-600 text-white' : 'border-gray-700 text-gray-300 hover:border-gray-500'
                          }`}
                        >
                          {r}
                        </button>
                      )
                    })}
                    </div>
                  </div>
                )}

                {pot && (
                  <p className="text-center text-sm text-gray-400">
                    Potential: <span className="text-white font-black text-lg">+{pot.total}</span> pts
                  </p>
                )}

                {error && <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>}

                {/* sticky nav */}
                <div className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-sm border-t border-gray-700 px-4 py-3 z-40">
                  <div className="max-w-3xl mx-auto flex gap-3">
                    <button type="button" onClick={() => backFromFight(idx)} className="px-5 py-3.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-bold">← Back</button>
                    <button
                      type="button"
                      onClick={() => nextFromFight(idx)}
                      disabled={!complete}
                      className={`flex-1 py-3.5 rounded-xl font-black text-lg transition-colors ${
                        complete ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      {idx < upcomingFights.length - 1 ? 'Next Fight →' : 'Review →'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* STEP: review */}
          {flowStep === 'review' && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-xl font-black text-white">Review Your Picks</h3>
                <p className="text-gray-300 text-sm mt-1">{name} · {wizComp?.name}{wizEntryNum > 1 ? ` · Entry #${wizEntryNum}` : ''}</p>
              </div>

              <div className="space-y-2">
                {upcomingFights.map((fight, i) => {
                  const pick = picks[fight.id]
                  return (
                    <div key={fight.id} className="bg-gray-900/70 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-gray-400 text-xs">Fight {fight.fight_number}</p>
                        <p className="text-white font-bold truncate">
                          {pick?.winner_pick || <span className="text-red-400">No pick</span>}
                          {pick?.method_pick && <span className="text-gray-400 font-normal"> · {pick.method_pick}{pick.round_pick ? ` R${pick.round_pick}` : ''}</span>}
                        </p>
                      </div>
                      <button type="button" onClick={() => { setError(''); setFlowStep(i) }} className="text-red-400 hover:text-red-300 text-sm font-bold shrink-0">Edit</button>
                    </div>
                  )
                })}
              </div>

              {error && <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>}

              <div className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-sm border-t border-gray-700 px-4 py-3 z-40">
                <div className="max-w-3xl mx-auto flex gap-3">
                  <button type="button" onClick={() => { setError(''); setFlowStep(upcomingFights.length > 0 ? upcomingFights.length - 1 : 'setup') }} className="px-5 py-3.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-bold">← Back</button>
                  <button type="button" onClick={() => setShowConfirmSheet(true)} className="flex-1 py-3.5 rounded-xl font-black text-lg bg-green-600 hover:bg-green-500 text-white transition-colors">Submit My Picks</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirm sheet */}
      {showConfirmSheet && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => !submitting && setShowConfirmSheet(false)}>
          <div className="w-full sm:max-w-md bg-gray-900 rounded-t-3xl sm:rounded-3xl border-t sm:border border-gray-700 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-white text-center">Lock in your picks?</h3>
            <p className="text-gray-300 text-sm text-center mt-1.5">You won't be able to change them.</p>
            <div className="mt-6 space-y-2.5">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white font-black text-lg py-4 rounded-2xl transition-colors"
              >
                {submitting ? 'Locking in…' : 'Yes, lock them in'}
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmSheet(false)}
                disabled={submitting}
                className="w-full bg-gray-800 hover:bg-gray-700 text-white font-bold py-4 rounded-2xl transition-colors"
              >
                Go back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
