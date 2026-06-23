'use client'

import { useEffect, useState, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatOdds } from '@/lib/scoring'
import type { Fight, Player } from '@/lib/types'

// ─── tiny shared components ────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  color,
}: {
  checked: boolean
  onChange: () => void
  color: 'green' | 'blue'
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors ${
        checked ? (color === 'green' ? 'bg-green-500' : 'bg-blue-500') : 'bg-gray-700'
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function StatusBadge({ status }: { status: Fight['status'] }) {
  const cls =
    status === 'complete'
      ? 'bg-green-900 text-green-300'
      : status === 'locked'
      ? 'bg-yellow-900 text-yellow-300'
      : 'bg-blue-900 text-blue-300'
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${cls}`}>
      {status.toUpperCase()}
    </span>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-bold text-white mb-4">{children}</h2>
}

// ─── fight form ────────────────────────────────────────────────────────────

interface FightFormData {
  id?: string
  fight_number: string
  fighter_a: string
  fighter_b: string
  odds_a: string
  odds_b: string
  rounds: string
}

const blankForm = (): FightFormData => ({
  fight_number: '',
  fighter_a: '',
  fighter_b: '',
  odds_a: '',
  odds_b: '',
  rounds: '3',
})

function FightForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: FightFormData
  onSave: (data: FightFormData) => void
  onCancel: () => void
  saving: boolean
}) {
  const [form, setForm] = useState<FightFormData>(initial)
  const set = (field: keyof FightFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  const inputCls =
    'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500 transition-colors placeholder-gray-600'

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Fight #</label>
          <input
            type="number"
            min={1}
            value={form.fight_number}
            onChange={(e) => set('fight_number', e.target.value)}
            placeholder="1"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Rounds</label>
          <select
            value={form.rounds}
            onChange={(e) => set('rounds', e.target.value)}
            className={inputCls}
          >
            <option value="3">3</option>
            <option value="5">5</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Fighter A</label>
          <input
            type="text"
            value={form.fighter_a}
            onChange={(e) => set('fighter_a', e.target.value)}
            placeholder="Last name or full name"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Fighter B</label>
          <input
            type="text"
            value={form.fighter_b}
            onChange={(e) => set('fighter_b', e.target.value)}
            placeholder="Last name or full name"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Fighter A Odds</label>
          <input
            type="number"
            value={form.odds_a}
            onChange={(e) => set('odds_a', e.target.value)}
            placeholder="-150 or +210"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Fighter B Odds</label>
          <input
            type="number"
            value={form.odds_b}
            onChange={(e) => set('odds_b', e.target.value)}
            placeholder="-150 or +210"
            className={inputCls}
          />
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <button
          onClick={() => onSave(form)}
          disabled={saving}
          className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white font-bold px-5 py-2 rounded-lg text-sm transition-colors"
        >
          {saving ? 'Saving…' : initial.id ? 'Save Changes' : 'Add Fight'}
        </button>
        <button
          onClick={onCancel}
          className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── result form (inline) ──────────────────────────────────────────────────

interface ResultFormState {
  winner: string
  method: string
  round: string
}

// ─── main page ─────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [players, setPlayers] = useState<Player[]>([])
  const [fights, setFights] = useState<Fight[]>([])
  const [dataLoading, setDataLoading] = useState(false)

  // fight form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fightFormSaving, setFightFormSaving] = useState(false)
  const [fightFormError, setFightFormError] = useState('')

  // result forms
  const [resultForms, setResultForms] = useState<Record<string, ResultFormState>>({})
  const [savingResults, setSavingResults] = useState<Record<string, boolean>>({})
  const [saveSuccess, setSaveSuccess] = useState<Record<string, boolean>>({})

  // reset
  const [resetting, setResetting] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)

  const loadData = useCallback(async () => {
    setDataLoading(true)
    const supabase = getSupabaseBrowser()
    const [{ data: playersData }, { data: fightsData }] = await Promise.all([
      supabase.from('players').select('*').order('created_at'),
      supabase.from('fights').select('*').order('fight_number'),
    ])
    if (playersData) setPlayers(playersData)
    if (fightsData) {
      setFights(fightsData)
      setResultForms((prev) => {
        const next: Record<string, ResultFormState> = {}
        fightsData.forEach((f) => {
          next[f.id] = prev[f.id] ?? {
            winner: f.result_winner ?? '',
            method: f.result_method ?? '',
            round: f.result_round?.toString() ?? '',
          }
        })
        return next
      })
    }
    setDataLoading(false)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (sessionStorage.getItem('fn_admin_authed') === 'true') {
        setAuthed(true)
        loadData()
      }
    }
  }, [loadData])

  // ── auth ──────────────────────────────────────────────────────────────────

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setAuthLoading(true)
    setAuthError('')
    const res = await fetch('/api/admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    const { valid } = await res.json()
    if (valid) {
      sessionStorage.setItem('fn_admin_authed', 'true')
      setAuthed(true)
      loadData()
    } else {
      setAuthError('Incorrect password.')
    }
    setAuthLoading(false)
  }

  // ── fight CRUD ────────────────────────────────────────────────────────────

  async function saveFight(data: FightFormData) {
    setFightFormError('')
    if (!data.fight_number || !data.fighter_a || !data.fighter_b || !data.odds_a || !data.odds_b) {
      setFightFormError('All fields are required.')
      return
    }
    setFightFormSaving(true)
    const res = await fetch('/api/upsert-fight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: data.id,
        fight_number: parseInt(data.fight_number, 10),
        fighter_a: data.fighter_a.trim(),
        fighter_b: data.fighter_b.trim(),
        odds_a: parseInt(data.odds_a, 10),
        odds_b: parseInt(data.odds_b, 10),
        rounds: parseInt(data.rounds, 10),
      }),
    })
    const result = await res.json()
    if (!res.ok) setFightFormError(result.error ?? 'Failed to save.')
    else {
      setShowAddForm(false)
      setEditingId(null)
      await loadData()
    }
    setFightFormSaving(false)
  }

  async function deleteFight(fightId: string) {
    if (!confirm('Delete this fight and all its picks? This cannot be undone.')) return
    await fetch('/api/delete-fight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fight_id: fightId }),
    })
    await loadData()
  }

  // ── player toggles ────────────────────────────────────────────────────────

  async function togglePlayer(id: string, field: 'paid' | 'activated', value: boolean) {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
    await fetch('/api/update-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: id, field, value }),
    })
  }

  // ── fight status ──────────────────────────────────────────────────────────

  async function advanceStatus(fight: Fight) {
    const next =
      fight.status === 'upcoming' ? 'locked' : fight.status === 'locked' ? 'complete' : null
    if (!next) return
    setFights((prev) => prev.map((f) => (f.id === fight.id ? { ...f, status: next } : f)))
    await fetch('/api/update-fight-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fight_id: fight.id, status: next }),
    })
  }

  // ── results ───────────────────────────────────────────────────────────────

  function setResult(fightId: string, field: keyof ResultFormState, value: string) {
    setResultForms((prev) => ({
      ...prev,
      [fightId]: {
        ...prev[fightId],
        [field]: value,
        ...(field === 'method' && value === 'Decision' ? { round: '' } : {}),
      },
    }))
  }

  async function saveResults(fight: Fight) {
    const form = resultForms[fight.id]
    if (!form?.winner || !form?.method) return
    setSavingResults((prev) => ({ ...prev, [fight.id]: true }))
    const res = await fetch('/api/save-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fight_id: fight.id,
        result_winner: form.winner,
        result_method: form.method,
        result_round:
          form.method !== 'Decision' && form.round ? parseInt(form.round, 10) : null,
      }),
    })
    setSavingResults((prev) => ({ ...prev, [fight.id]: false }))
    if (res.ok) {
      setSaveSuccess((prev) => ({ ...prev, [fight.id]: true }))
      setTimeout(() => setSaveSuccess((prev) => ({ ...prev, [fight.id]: false })), 3000)
      await loadData()
    }
  }

  // ── reset ─────────────────────────────────────────────────────────────────

  async function resetEvent() {
    setResetting(true)
    await fetch('/api/reset-event', { method: 'POST' })
    setResetConfirm(false)
    setResetting(false)
    await loadData()
  }

  // ─── auth gate ────────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-sm">
          <h1 className="text-2xl font-black text-white mb-1 text-center">ADMIN</h1>
          <p className="text-gray-500 text-sm text-center mb-6">UFC Fight Night Pick'em</p>
          <form onSubmit={handleAuth} className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-red-500 transition-colors"
            />
            {authError && <p className="text-red-400 text-sm">{authError}</p>}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white font-bold py-3 rounded-xl transition-colors"
            >
              {authLoading ? 'Checking…' : 'Enter'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  const paidCount = players.filter((p) => p.paid).length
  const activatedCount = players.filter((p) => p.activated).length
  const tier25 = players.filter((p) => p.tier === '$25').length
  const tier100 = players.filter((p) => p.tier === '$100').length

  // ─── main UI ──────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black text-white">UFC FIGHT NIGHT &mdash; ADMIN</h1>
          <p className="text-gray-500 text-sm mt-0.5">Fight setup, player management & scoring</p>
        </div>
        <button
          onClick={loadData}
          disabled={dataLoading}
          className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {dataLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        {[
          { label: 'Players Paid', value: paidCount, color: 'text-green-400' },
          { label: 'Activated', value: activatedCount, color: 'text-blue-400' },
          { label: '$25 Entries', value: tier25, color: 'text-yellow-400' },
          { label: '$100 Entries', value: tier100, color: 'text-orange-400' },
        ].map((s) => (
          <div key={s.label} className="bg-gray-900 rounded-xl p-4 text-center">
            <div className={`text-4xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-gray-500 text-sm mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── SECTION 1: Fight Card Setup ───────────────────────────────────── */}
      <section className="mb-10">
        <div className="flex justify-between items-center mb-4">
          <SectionHeader>Fight Card Setup</SectionHeader>
          {!showAddForm && (
            <button
              onClick={() => { setShowAddForm(true); setEditingId(null) }}
              className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              + Add Fight
            </button>
          )}
        </div>

        {showAddForm && (
          <div className="mb-4">
            <p className="text-sm text-gray-400 mb-2">New Fight</p>
            <FightForm
              initial={{ ...blankForm(), fight_number: String(fights.length + 1) }}
              onSave={saveFight}
              onCancel={() => { setShowAddForm(false); setFightFormError('') }}
              saving={fightFormSaving}
            />
            {fightFormError && (
              <p className="text-red-400 text-sm mt-2">{fightFormError}</p>
            )}
          </div>
        )}

        {fights.length === 0 && !showAddForm && (
          <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-600">
            No fights added yet. Click <span className="text-red-500 font-semibold">+ Add Fight</span> to set up the card.
          </div>
        )}

        <div className="space-y-3">
          {fights.map((fight) => {
            const isEditing = editingId === fight.id

            return (
              <div key={fight.id} className="bg-gray-900 rounded-xl p-5">
                {isEditing ? (
                  <>
                    <p className="text-sm text-gray-400 mb-3">
                      Editing Fight {fight.fight_number}
                    </p>
                    <FightForm
                      initial={{
                        id: fight.id,
                        fight_number: String(fight.fight_number),
                        fighter_a: fight.fighter_a,
                        fighter_b: fight.fighter_b,
                        odds_a: String(fight.odds_a),
                        odds_b: String(fight.odds_b),
                        rounds: String(fight.rounds),
                      }}
                      onSave={saveFight}
                      onCancel={() => { setEditingId(null); setFightFormError('') }}
                      saving={fightFormSaving}
                    />
                    {fightFormError && (
                      <p className="text-red-400 text-sm mt-2">{fightFormError}</p>
                    )}
                  </>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-gray-500 text-xs font-semibold">
                          FIGHT {fight.fight_number}
                        </span>
                        <StatusBadge status={fight.status} />
                        <span className="text-gray-600 text-xs">{fight.rounds}R</span>
                      </div>
                      <div className="text-white font-bold">
                        {fight.fighter_a}{' '}
                        <span className={`text-sm font-bold ${fight.odds_a > 0 ? 'text-green-400' : 'text-gray-400'}`}>
                          ({formatOdds(fight.odds_a)})
                        </span>
                        <span className="text-gray-600 mx-2">vs</span>
                        {fight.fighter_b}{' '}
                        <span className={`text-sm font-bold ${fight.odds_b > 0 ? 'text-green-400' : 'text-gray-400'}`}>
                          ({formatOdds(fight.odds_b)})
                        </span>
                      </div>
                    </div>

                    {fight.status === 'upcoming' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditingId(fight.id); setShowAddForm(false) }}
                          className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteFight(fight.id)}
                          className="bg-gray-800 hover:bg-red-900 text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── SECTION 2: Player Management ──────────────────────────────────── */}
      <section className="mb-10">
        <SectionHeader>Player Management</SectionHeader>
        <div className="bg-gray-900 rounded-xl overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-800">
                {['Name', 'Contact', 'Tier', 'Tiebreaker', 'Signed Up', 'Paid', 'Activated'].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left text-xs text-gray-500 uppercase tracking-wider px-4 py-3 font-semibold"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {players.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-600">
                    No players yet
                  </td>
                </tr>
              ) : (
                players.map((player) => (
                  <tr key={player.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-3 text-white font-semibold">{player.name}</td>
                    <td className="px-4 py-3 text-gray-300">{player.contact}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          player.tier === '$100'
                            ? 'bg-orange-900/60 text-orange-300'
                            : 'bg-yellow-900/60 text-yellow-300'
                        }`}
                      >
                        {player.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300 font-mono">{player.tiebreaker}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(player.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Toggle
                        checked={player.paid}
                        onChange={() => togglePlayer(player.id, 'paid', !player.paid)}
                        color="green"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Toggle
                        checked={player.activated}
                        onChange={() => togglePlayer(player.id, 'activated', !player.activated)}
                        color="blue"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── SECTION 3: Fight Status & Scoring ─────────────────────────────── */}
      <section className="mb-10">
        <SectionHeader>Fight Status &amp; Scoring</SectionHeader>
        <div className="space-y-4">
          {fights.length === 0 && (
            <div className="bg-gray-900 rounded-xl p-6 text-center text-gray-600">
              Add fights above to manage their status.
            </div>
          )}
          {fights.map((fight) => {
            const form = resultForms[fight.id]
            const isSaving = savingResults[fight.id]
            const didSave = saveSuccess[fight.id]

            return (
              <div key={fight.id} className="bg-gray-900 rounded-xl p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-gray-500 text-xs font-semibold">FIGHT {fight.fight_number}</span>
                      <StatusBadge status={fight.status} />
                    </div>
                    <h3 className="text-white font-bold">
                      {fight.fighter_a} <span className="text-gray-500">vs</span> {fight.fighter_b}
                    </h3>
                    <p className="text-gray-500 text-sm">
                      {fight.rounds} rounds &bull; {fight.fighter_a}: {formatOdds(fight.odds_a)} &bull; {fight.fighter_b}: {formatOdds(fight.odds_b)}
                    </p>
                  </div>

                  {fight.status !== 'complete' && (
                    <button
                      onClick={() => advanceStatus(fight)}
                      className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shrink-0"
                    >
                      {fight.status === 'upcoming' ? 'Lock Picks' : 'Mark Complete'} &rarr;
                    </button>
                  )}
                </div>

                {fight.status === 'complete' && form && (
                  <div className="mt-4 pt-4 border-t border-gray-800">
                    <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">
                      Enter Results
                    </p>
                    <div className="flex flex-wrap gap-3 items-end">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Winner</label>
                        <select
                          value={form.winner}
                          onChange={(e) => setResult(fight.id, 'winner', e.target.value)}
                          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
                        >
                          <option value="">Select winner</option>
                          <option value={fight.fighter_a}>{fight.fighter_a}</option>
                          <option value={fight.fighter_b}>{fight.fighter_b}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Method</label>
                        <select
                          value={form.method}
                          onChange={(e) => setResult(fight.id, 'method', e.target.value)}
                          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
                        >
                          <option value="">Select method</option>
                          <option value="KO/TKO">KO/TKO</option>
                          <option value="Submission">Submission</option>
                          <option value="Decision">Decision</option>
                        </select>
                      </div>
                      {form.method && form.method !== 'Decision' && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Round</label>
                          <input
                            type="number"
                            min={1}
                            max={fight.rounds}
                            value={form.round}
                            onChange={(e) => setResult(fight.id, 'round', e.target.value)}
                            placeholder={`1–${fight.rounds}`}
                            className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => saveResults(fight)}
                        disabled={isSaving || !form.winner || !form.method}
                        className="bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-bold transition-colors"
                      >
                        {isSaving ? 'Saving…' : 'Save & Score'}
                      </button>
                      {didSave && (
                        <span className="text-green-400 text-sm font-semibold">
                          Scores calculated!
                        </span>
                      )}
                    </div>
                    {fight.result_winner && (
                      <p className="mt-3 text-sm text-gray-400">
                        Saved:{' '}
                        <span className="text-white font-semibold">{fight.result_winner}</span>
                        {' by '}
                        <span className="text-white font-semibold">{fight.result_method}</span>
                        {fight.result_round != null && ` (Round ${fight.result_round})`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Danger Zone ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold text-red-500 mb-3">Danger Zone</h2>
        <div className="bg-gray-900 border border-red-900/40 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-white font-semibold">Reset Event</p>
              <p className="text-gray-500 text-sm">
                Deletes all fights, players, picks, and scores. Use between events.
              </p>
            </div>
            {!resetConfirm ? (
              <button
                onClick={() => setResetConfirm(true)}
                className="bg-red-900/60 hover:bg-red-800 text-red-300 border border-red-700 font-bold px-5 py-2 rounded-lg text-sm transition-colors"
              >
                Reset Event
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-red-400 text-sm font-semibold">Are you sure?</span>
                <button
                  onClick={resetEvent}
                  disabled={resetting}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  {resetting ? 'Resetting…' : 'Yes, delete everything'}
                </button>
                <button
                  onClick={() => setResetConfirm(false)}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
