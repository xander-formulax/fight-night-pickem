'use client'

import { useEffect, useState, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatOdds } from '@/lib/scoring'
import type { Competition, Fight, Player, PrizeSplit } from '@/lib/types'
import type { ImportedFight, ImportEventGroup } from '@/app/api/import-ufc-card/route'

// ─── shared primitives ─────────────────────────────────────────────────────

function Toggle({ checked, onChange, color }: { checked: boolean; onChange: () => void; color: 'green' | 'blue' }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? (color === 'green' ? 'bg-green-500' : 'bg-blue-500') : 'bg-gray-700'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function StatusBadge({ status }: { status: Fight['status'] }) {
  const cls = status === 'complete' ? 'bg-green-900 text-green-300' : status === 'locked' ? 'bg-yellow-900 text-yellow-300' : 'bg-blue-900 text-blue-300'
  return <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${cls}`}>{status.toUpperCase()}</span>
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-bold text-white mb-4">{children}</h2>
}

const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500 transition-colors placeholder-gray-600'

// ─── competition form ───────────────────────────────────────────────────────

interface SplitRow { place: number; pct: string }
interface CompFormData { id?: string; name: string; entry_fee: string; description: string; expense_cut_pct: string; prize_splits: SplitRow[] }
const blankComp = (): CompFormData => ({ name: '', entry_fee: '', description: '', expense_cut_pct: '50', prize_splits: [] })

function ordinal(n: number) {
  if (n === 1) return '1st'; if (n === 2) return '2nd'; if (n === 3) return '3rd'; return `${n}th`
}

function parseFee(fee: string) { return parseFloat(fee.replace(/[^0-9.]/g, '')) || 0 }

function calcExpenseRecovery(comps: Competition[], players: Player[], partyCostTarget: number) {
  let totalExpenseContrib = 0
  const poolData = comps.map((comp) => {
    const paidCount = players.filter((p) => p.competition_id === comp.id && p.paid).length
    const fee = parseFee(comp.entry_fee)
    const expensePct = (comp.expense_cut_pct ?? 50) / 100
    const totalPaid = paidCount * fee
    const expenseContrib = totalPaid * expensePct
    totalExpenseContrib += expenseContrib
    return { comp, paidCount, fee, totalPaid, expenseContrib }
  })
  const expenseCovered = Math.min(totalExpenseContrib, partyCostTarget)
  const surplus = Math.max(0, totalExpenseContrib - partyCostTarget)
  const expenseStillNeeded = Math.max(0, partyCostTarget - totalExpenseContrib)
  return {
    totalExpenseContrib,
    expenseCovered,
    surplus,
    expenseStillNeeded,
    poolData: poolData.map((p) => {
      const basePrize = p.totalPaid * (1 - (p.comp.expense_cut_pct ?? 50) / 100)
      const poolSurplus = totalExpenseContrib > 0 ? (p.expenseContrib / totalExpenseContrib) * surplus : 0
      return { ...p, basePrize, actualPrizePool: basePrize + poolSurplus }
    }),
  }
}

function CompetitionForm({ initial, onSave, onCancel, saving, error, partyCostTarget, existingExpenseCovered }: {
  initial: CompFormData; onSave: (d: CompFormData) => void; onCancel: () => void; saving: boolean; error: string
  partyCostTarget: number; existingExpenseCovered: number
}) {
  const [form, setForm] = useState(initial)
  const set = (k: keyof CompFormData, v: string) => setForm((p) => ({ ...p, [k]: v }))

  function addPlace() {
    setForm((p) => ({ ...p, prize_splits: [...p.prize_splits, { place: p.prize_splits.length + 1, pct: '' }] }))
  }
  function removePlace(idx: number) {
    setForm((p) => ({ ...p, prize_splits: p.prize_splits.filter((_, i) => i !== idx).map((s, i) => ({ ...s, place: i + 1 })) }))
  }
  function setSplitPct(idx: number, pct: string) {
    setForm((p) => ({ ...p, prize_splits: p.prize_splits.map((s, i) => i === idx ? { ...s, pct } : s) }))
  }

  const [calcPlayers, setCalcPlayers] = useState('50')

  const splitTotal = form.prize_splits.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0)
  const splitOk = form.prize_splits.length === 0 || Math.abs(splitTotal - 100) < 0.01
  const remaining = 100 - splitTotal

  const feeNum = parseFee(form.entry_fee)
  const expenseCutNum = parseFloat(form.expense_cut_pct) || 0
  const calcCount = Math.max(0, parseInt(calcPlayers) || 0)
  const calcPot = feeNum * calcCount

  // Expense recovery calc for this pool's calculator
  const remainingExpenseNeeded = Math.max(0, partyCostTarget - existingExpenseCovered)
  const expensePerPlayer = feeNum * (expenseCutNum / 100)
  const playersToBreakeven = partyCostTarget > 0 && expensePerPlayer > 0
    ? Math.ceil(remainingExpenseNeeded / expensePerPlayer)
    : null

  // At calcCount players, how much goes to expenses vs prizes?
  const thisPoolExpenseContrib = expenseCutNum > 0 ? feeNum * calcCount * (expenseCutNum / 100) : 0
  const thisPoolSurplus = partyCostTarget > 0
    ? Math.max(0, thisPoolExpenseContrib - remainingExpenseNeeded)
    : 0
  const actualExpenseTaken = thisPoolExpenseContrib - thisPoolSurplus
  const calcPrizePot = calcPot - actualExpenseTaken

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Pool Name</label>
          <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Budget Bracket" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Entry Fee</label>
          <input type="text" value={form.entry_fee} onChange={(e) => set('entry_fee', e.target.value)} placeholder="e.g. $25" className={inputCls} />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Description (optional — shown to players)</label>
        <input type="text" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Top 3 places paid out" className={inputCls} />
      </div>

      {/* Expense cut */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Expense Cut %</label>
        <p className="text-xs text-gray-600 mb-1.5">Portion of each buy-in that goes toward party cost recovery. Once the target is met, 100% goes to prizes.</p>
        <div className="flex items-center gap-2">
          <input type="number" min={0} max={100} value={form.expense_cut_pct} onChange={(e) => set('expense_cut_pct', e.target.value)} placeholder="50" className="w-24" style={{ background:'#1f2937', border:'1px solid #374151', borderRadius:'8px', padding:'6px 12px', color:'white', outline:'none', fontSize:'14px' }} />
          <span className="text-gray-400 text-sm">%</span>
          {feeNum > 0 && expenseCutNum > 0 && (
            <span className="text-gray-500 text-xs">= ${(feeNum * expenseCutNum / 100).toFixed(2)} per player</span>
          )}
        </div>
      </div>

      {/* Prize splits */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <label className="block text-xs text-gray-400">Prize Splits</label>
            <p className="text-xs text-gray-600">% of prize pool. Must total 100%.</p>
          </div>
          <button type="button" onClick={addPlace} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg transition-colors">+ Add Place</button>
        </div>

        {form.prize_splits.length === 0 && (
          <p className="text-gray-700 text-xs italic py-2">No splits set — click &ldquo;Add Place&rdquo; to configure payouts.</p>
        )}

        <div className="space-y-2">
          {form.prize_splits.map((split, idx) => {
            const pctNum = parseFloat(split.pct) || 0
            const dollarPreview = feeNum > 0 && pctNum > 0 && calcCount > 0 ? `≈ $${(calcPrizePot * pctNum / 100).toFixed(0)}` : ''
            return (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-gray-400 text-sm w-8 shrink-0">{ordinal(split.place)}</span>
                <input
                  type="number" min={0} max={100} step={0.1}
                  value={split.pct}
                  onChange={(e) => setSplitPct(idx, e.target.value)}
                  placeholder="0"
                  className="w-20"
                  style={{ background:'#111827', border:'1px solid #374151', borderRadius:'8px', padding:'6px 10px', color:'white', outline:'none', fontSize:'14px' }}
                />
                <span className="text-gray-500 text-sm">%</span>
                {dollarPreview && <span className="text-gray-600 text-xs">{dollarPreview}</span>}
                <button type="button" onClick={() => removePlace(idx)} className="ml-auto text-gray-700 hover:text-red-500 text-xs transition-colors">Remove</button>
              </div>
            )
          })}
        </div>

        {form.prize_splits.length > 0 && (
          <div className={`mt-2 text-xs font-semibold ${splitOk ? 'text-green-500' : splitTotal > 100 ? 'text-red-400' : 'text-yellow-400'}`}>
            {splitOk ? '✓ Splits total 100%' : splitTotal > 100 ? `${splitTotal.toFixed(1)}% — over by ${(splitTotal - 100).toFixed(1)}%` : `${splitTotal.toFixed(1)}% — ${remaining.toFixed(1)}% remaining`}
          </div>
        )}
      </div>

      {/* Prize Calculator */}
      {feeNum > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-700/50">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Prize Calculator</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">If</label>
              <input
                type="number" min={1} max={9999}
                value={calcPlayers}
                onChange={(e) => setCalcPlayers(e.target.value)}
                className="w-16 text-center text-sm font-bold text-white bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 focus:outline-none focus:border-red-500"
              />
              <label className="text-xs text-gray-500">buy in</label>
            </div>
          </div>

          {calcCount > 0 ? (
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total pot</span>
                <span className="text-white font-semibold">${calcPot.toLocaleString()}</span>
              </div>
              {expenseCutNum > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">
                    Expense cut ({expenseCutNum}%)
                    {partyCostTarget > 0 && thisPoolSurplus > 0 && <span className="text-green-500 ml-1">· target met!</span>}
                  </span>
                  <span className="text-orange-400 font-semibold">
                    −${actualExpenseTaken.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    {thisPoolSurplus > 0 && <span className="text-gray-600 text-xs"> (${thisPoolSurplus.toFixed(0)} back)</span>}
                  </span>
                </div>
              )}
              {partyCostTarget > 0 && expenseCutNum > 0 && playersToBreakeven !== null && (
                <div className="text-xs text-gray-600 pb-1">
                  {playersToBreakeven <= 0
                    ? 'Party expenses already covered by other pools.'
                    : calcCount >= playersToBreakeven
                    ? `Target covered at player ${playersToBreakeven} — remaining ${calcCount - playersToBreakeven} go 100% to prizes.`
                    : `Need ${playersToBreakeven} players to cover remaining $${remainingExpenseNeeded.toFixed(0)} in expenses.`}
                </div>
              )}
              {(expenseCutNum > 0 || form.prize_splits.length > 0) && (
                <div className="flex justify-between text-sm border-t border-gray-700 pt-1.5">
                  <span className="text-gray-400">Prize pool</span>
                  <span className="text-white font-bold">${calcPrizePot.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
              )}
              {form.prize_splits.length > 0 && (
                <div className="space-y-1 pt-1">
                  {form.prize_splits.map((s) => {
                    const pct = parseFloat(s.pct) || 0
                    const amt = calcPrizePot * (pct / 100)
                    return (
                      <div key={s.place} className="flex justify-between text-sm">
                        <span className="text-gray-500">{ordinal(s.place)} place ({pct}%)</span>
                        <span className={`font-bold ${s.place === 1 ? 'text-yellow-400' : s.place === 2 ? 'text-gray-300' : s.place === 3 ? 'text-amber-600' : 'text-green-400'}`}>
                          ${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              {form.prize_splits.length === 0 && expenseCutNum === 0 && (
                <p className="text-gray-700 text-xs italic">Add an expense cut or prize splits above to see the breakdown.</p>
              )}
            </div>
          ) : (
            <p className="text-gray-700 text-xs italic">Enter a player count above.</p>
          )}
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button onClick={() => onSave(form)} disabled={saving} className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white font-bold px-5 py-2 rounded-lg text-sm transition-colors">
          {saving ? 'Saving…' : initial.id ? 'Save Changes' : 'Add Pool'}
        </button>
        <button onClick={onCancel} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors">Cancel</button>
      </div>
    </div>
  )
}

// ─── fight form ─────────────────────────────────────────────────────────────

interface FightFormData { id?: string; fight_number: string; fighter_a: string; fighter_b: string; odds_a: string; odds_b: string; rounds: string }
const blankFight = (): FightFormData => ({ fight_number: '', fighter_a: '', fighter_b: '', odds_a: '', odds_b: '', rounds: '3' })

function FightForm({ initial, onSave, onCancel, saving, error }: {
  initial: FightFormData; onSave: (d: FightFormData) => void; onCancel: () => void; saving: boolean; error: string
}) {
  const [form, setForm] = useState(initial)
  const set = (k: keyof FightFormData, v: string) => setForm((p) => ({ ...p, [k]: v }))
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Fight #</label>
          <input type="number" min={1} value={form.fight_number} onChange={(e) => set('fight_number', e.target.value)} placeholder="1" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Rounds</label>
          <select value={form.rounds} onChange={(e) => set('rounds', e.target.value)} className={inputCls}>
            <option value="3">3</option>
            <option value="5">5</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Fighter A</label>
          <input type="text" value={form.fighter_a} onChange={(e) => set('fighter_a', e.target.value)} placeholder="Name" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Fighter B</label>
          <input type="text" value={form.fighter_b} onChange={(e) => set('fighter_b', e.target.value)} placeholder="Name" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Fighter A Odds</label>
          <input type="number" value={form.odds_a} onChange={(e) => set('odds_a', e.target.value)} placeholder="-150 or +210" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Fighter B Odds</label>
          <input type="number" value={form.odds_b} onChange={(e) => set('odds_b', e.target.value)} placeholder="-150 or +210" className={inputCls} />
        </div>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button onClick={() => onSave(form)} disabled={saving} className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white font-bold px-5 py-2 rounded-lg text-sm transition-colors">
          {saving ? 'Saving…' : initial.id ? 'Save Changes' : 'Add Fight'}
        </button>
        <button onClick={onCancel} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors">Cancel</button>
      </div>
    </div>
  )
}

// ─── result form state ──────────────────────────────────────────────────────

interface ResultFormState { winner: string; method: string; round: string }

// ─── main page ──────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [fights, setFights] = useState<Fight[]>([])
  const [dataLoading, setDataLoading] = useState(false)

  // party cost recovery
  const [partyCostTarget, setPartyCostTarget] = useState(0)
  const [partyCostInput, setPartyCostInput] = useState('')
  const [partyCostSaving, setPartyCostSaving] = useState(false)

  // competition form
  const [showAddComp, setShowAddComp] = useState(false)
  const [editingCompId, setEditingCompId] = useState<string | null>(null)
  const [compSaving, setCompSaving] = useState(false)
  const [compError, setCompError] = useState('')

  // fight form
  const [showAddFight, setShowAddFight] = useState(false)
  const [editingFightId, setEditingFightId] = useState<string | null>(null)
  const [fightSaving, setFightSaving] = useState(false)
  const [fightError, setFightError] = useState('')

  // import from odds api
  const [showImport, setShowImport] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState('')
  const [importEvents, setImportEvents] = useState<ImportEventGroup[]>([])
  const [importingSaving, setImportingSaving] = useState(false)
  const [importSuccess, setImportSuccess] = useState('')
  const [selectedFights, setSelectedFights] = useState<Record<string, Set<number>>>({})

  function toggleFight(date: string, idx: number) {
    setSelectedFights((prev) => {
      const s = new Set(prev[date] ?? [])
      if (s.has(idx)) s.delete(idx); else s.add(idx)
      return { ...prev, [date]: s }
    })
  }

  function toggleAllFights(date: string, fights: ImportedFight[], checked: boolean) {
    setSelectedFights((prev) => ({
      ...prev,
      [date]: checked ? new Set(fights.map((_, i) => i)) : new Set(),
    }))
  }

  // results
  const [resultForms, setResultForms] = useState<Record<string, ResultFormState>>({})
  const [savingResults, setSavingResults] = useState<Record<string, boolean>>({})
  const [saveSuccess, setSaveSuccess] = useState<Record<string, boolean>>({})

  // reset
  const [resetting, setResetting] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)

  const loadData = useCallback(async () => {
    setDataLoading(true)
    const supabase = getSupabaseBrowser()
    const [{ data: compsData }, { data: playersData }, { data: fightsData }, settingsRes] = await Promise.all([
      supabase.from('competitions').select('*').order('created_at'),
      supabase.from('players').select('*').order('created_at'),
      supabase.from('fights').select('*').order('fight_number'),
      fetch('/api/event-settings'),
    ])
    if (compsData) setCompetitions(compsData)
    if (playersData) setPlayers(playersData)
    if (fightsData) {
      setFights(fightsData)
      setResultForms((prev) => {
        const next: Record<string, ResultFormState> = {}
        fightsData.forEach((f) => {
          next[f.id] = prev[f.id] ?? { winner: f.result_winner ?? '', method: f.result_method ?? '', round: f.result_round?.toString() ?? '' }
        })
        return next
      })
    }
    if (settingsRes.ok) {
      const settings = await settingsRes.json()
      const target = parseFloat(settings.party_cost_target) || 0
      setPartyCostTarget(target)
      setPartyCostInput(target > 0 ? String(target) : '')
    }
    setDataLoading(false)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('fn_admin_authed') === 'true') {
      setAuthed(true)
      loadData()
    }
  }, [loadData])

  // ── auth ──────────────────────────────────────────────────────────────────

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setAuthLoading(true)
    setAuthError('')
    const res = await fetch('/api/admin-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    const { valid } = await res.json()
    if (valid) { sessionStorage.setItem('fn_admin_authed', 'true'); setAuthed(true); loadData() }
    else setAuthError('Incorrect password.')
    setAuthLoading(false)
  }

  // ── competitions ──────────────────────────────────────────────────────────

  async function saveComp(data: CompFormData) {
    setCompError('')
    if (!data.name.trim() || !data.entry_fee.trim()) { setCompError('Name and entry fee are required.'); return }
    const splits: PrizeSplit[] = data.prize_splits.map((s) => ({ place: s.place, pct: parseFloat(s.pct) || 0 }))
    if (splits.length > 0) {
      const total = splits.reduce((s, r) => s + r.pct, 0)
      if (Math.abs(total - 100) > 0.01) { setCompError(`Prize splits must total 100% (currently ${total.toFixed(1)}%).`); return }
    }
    setCompSaving(true)
    const res = await fetch('/api/upsert-competition', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: data.id, name: data.name, entry_fee: data.entry_fee, description: data.description, expense_cut_pct: parseFloat(data.expense_cut_pct) || 0, prize_splits: splits }),
    })
    const result = await res.json()
    if (!res.ok) setCompError(result.error ?? 'Failed to save.')
    else { setShowAddComp(false); setEditingCompId(null); await loadData() }
    setCompSaving(false)
  }

  async function savePartyCost() {
    setPartyCostSaving(true)
    const target = Math.max(0, parseFloat(partyCostInput) || 0)
    const res = await fetch('/api/event-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ party_cost_target: target }),
    })
    if (res.ok) setPartyCostTarget(target)
    setPartyCostSaving(false)
  }

  async function deleteComp(id: string) {
    const res = await fetch('/api/delete-competition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ competition_id: id }) })
    const result = await res.json()
    if (!res.ok) alert(result.error)
    else await loadData()
  }

  // ── fights ────────────────────────────────────────────────────────────────

  async function saveFight(data: FightFormData) {
    setFightError('')
    if (!data.fight_number || !data.fighter_a || !data.fighter_b || !data.odds_a || !data.odds_b) { setFightError('All fields are required.'); return }
    setFightSaving(true)
    const res = await fetch('/api/upsert-fight', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: data.id, fight_number: parseInt(data.fight_number, 10), fighter_a: data.fighter_a.trim(), fighter_b: data.fighter_b.trim(), odds_a: parseInt(data.odds_a, 10), odds_b: parseInt(data.odds_b, 10), rounds: parseInt(data.rounds, 10) }),
    })
    const result = await res.json()
    if (!res.ok) setFightError(result.error ?? 'Failed to save.')
    else { setShowAddFight(false); setEditingFightId(null); await loadData() }
    setFightSaving(false)
  }

  async function deleteFight(id: string) {
    if (!confirm('Delete this fight and all its picks?')) return
    await fetch('/api/delete-fight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fight_id: id }) })
    await loadData()
  }

  async function advanceStatus(fight: Fight) {
    const next = fight.status === 'upcoming' ? 'locked' : fight.status === 'locked' ? 'complete' : null
    if (!next) return
    setFights((prev) => prev.map((f) => f.id === fight.id ? { ...f, status: next } : f))
    await fetch('/api/update-fight-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fight_id: fight.id, status: next }) })
  }

  // ── players ───────────────────────────────────────────────────────────────

  async function togglePlayer(id: string, field: 'paid' | 'activated', value: boolean) {
    setPlayers((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p))
    await fetch('/api/update-player', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: id, field, value }) })
  }

  // ── results ───────────────────────────────────────────────────────────────

  function setResult(fightId: string, field: keyof ResultFormState, value: string) {
    setResultForms((prev) => ({ ...prev, [fightId]: { ...prev[fightId], [field]: value, ...(field === 'method' && value === 'Decision' ? { round: '' } : {}) } }))
  }

  async function saveResults(fight: Fight) {
    const form = resultForms[fight.id]
    if (!form?.winner || !form?.method) return
    setSavingResults((prev) => ({ ...prev, [fight.id]: true }))
    const res = await fetch('/api/save-results', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fight_id: fight.id, result_winner: form.winner, result_method: form.method, result_round: form.method !== 'Decision' && form.round ? parseInt(form.round, 10) : null }),
    })
    setSavingResults((prev) => ({ ...prev, [fight.id]: false }))
    if (res.ok) {
      setSaveSuccess((prev) => ({ ...prev, [fight.id]: true }))
      setTimeout(() => setSaveSuccess((prev) => ({ ...prev, [fight.id]: false })), 3000)
      await loadData()
    }
  }

  // ── import from odds api ──────────────────────────────────────────────────

  async function fetchImportCards() {
    setImportLoading(true)
    setImportError('')
    setImportEvents([])
    setImportSuccess('')
    setSelectedFights({})
    const res = await fetch('/api/import-ufc-card')
    const data = await res.json()
    if (!res.ok) setImportError(data.error ?? 'Failed to fetch cards.')
    else if (!data.events?.length) setImportError('No upcoming MMA events with odds found yet. Try again closer to fight week.')
    else {
      setImportEvents(data.events)
      const initial: Record<string, Set<number>> = {}
      ;(data.events as ImportEventGroup[]).forEach((g) => {
        initial[g.date] = new Set(g.fights.map((_, i) => i))
      })
      setSelectedFights(initial)
    }
    setImportLoading(false)
  }

  async function importCard(group: ImportEventGroup) {
    const selected = selectedFights[group.date] ?? new Set<number>()
    const fightsToImport = group.fights.filter((_, i) => selected.has(i))
    if (fightsToImport.length === 0) { setImportError('Select at least one fight.'); return }
    setImportingSaving(true)
    setImportSuccess('')
    const startNumber = fights.length > 0 ? Math.max(...fights.map((f) => f.fight_number)) + 1 : 1
    const res = await fetch('/api/import-fights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fights: fightsToImport, start_number: startNumber }),
    })
    const data = await res.json()
    if (!res.ok) setImportError(data.error ?? 'Import failed.')
    else {
      setImportSuccess(`Imported ${data.count} fight${data.count !== 1 ? 's' : ''}! Review and adjust rounds as needed.`)
      setShowImport(false)
      setImportEvents([])
      await loadData()
    }
    setImportingSaving(false)
  }

  // ── reset ─────────────────────────────────────────────────────────────────

  async function resetEvent() {
    setResetting(true)
    await fetch('/api/reset-event', { method: 'POST' })
    setResetConfirm(false)
    setResetting(false)
    await loadData()
  }

  // ── auth gate ─────────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-sm">
          <h1 className="text-2xl font-black text-white mb-1 text-center">ADMIN</h1>
          <p className="text-gray-500 text-sm text-center mb-6">UFC Fight Night Pick'em</p>
          <form onSubmit={handleAuth} className="space-y-4">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Admin password" autoFocus className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-red-500 transition-colors" />
            {authError && <p className="text-red-400 text-sm">{authError}</p>}
            <button type="submit" disabled={authLoading} className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white font-bold py-3 rounded-xl transition-colors">{authLoading ? 'Checking…' : 'Enter'}</button>
          </form>
        </div>
      </div>
    )
  }

  // ── stats ─────────────────────────────────────────────────────────────────

  const paidCount = players.filter((p) => p.paid).length
  const activatedCount = players.filter((p) => p.activated).length

  const expenseRecovery = calcExpenseRecovery(competitions, players, partyCostTarget)

  function getExistingExpenseCovered(excludeCompId?: string) {
    return Math.min(
      competitions
        .filter((c) => c.id !== excludeCompId)
        .reduce((sum, c) => {
          const paid = players.filter((p) => p.competition_id === c.id && p.paid).length
          return sum + paid * parseFee(c.entry_fee) * ((c.expense_cut_pct ?? 50) / 100)
        }, 0),
      partyCostTarget
    )
  }

  // ── main UI ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black text-white">UFC FIGHT NIGHT &mdash; ADMIN</h1>
          <p className="text-gray-500 text-sm mt-0.5">Competitions, fights, players &amp; scoring</p>
        </div>
        <button onClick={loadData} disabled={dataLoading} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          {dataLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <div className="bg-gray-900 rounded-xl p-4 text-center">
          <div className="text-4xl font-black text-green-400">{paidCount}</div>
          <div className="text-gray-500 text-sm mt-1">Players Paid</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 text-center">
          <div className="text-4xl font-black text-blue-400">{activatedCount}</div>
          <div className="text-gray-500 text-sm mt-1">Activated</div>
        </div>
        {competitions.map((comp) => {
          const count = players.filter((p) => p.competition_id === comp.id).length
          return (
            <div key={comp.id} className="bg-gray-900 rounded-xl p-4 text-center">
              <div className="text-4xl font-black text-orange-400">{count}</div>
              <div className="text-gray-500 text-sm mt-1 truncate">{comp.name} ({comp.entry_fee})</div>
            </div>
          )
        })}
      </div>

      {/* ── SECTION 1: Prize Pool Setup ───────────────────────────────────── */}
      <section className="mb-10">
        <div className="flex justify-between items-center mb-4">
          <SectionHeader>Prize Pool Setup</SectionHeader>
          {!showAddComp && (
            <button onClick={() => { setShowAddComp(true); setEditingCompId(null) }} className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors">
              + Add Pool
            </button>
          )}
        </div>

        {/* Party Cost Recovery card */}
        <div className="bg-gray-900 rounded-xl p-5 mb-5 border border-gray-800">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">Party Cost Recovery</p>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="text-sm text-gray-400 shrink-0">Expense Target</label>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm">$</span>
              <input
                type="number" min={0} step={1}
                value={partyCostInput}
                onChange={(e) => setPartyCostInput(e.target.value)}
                placeholder="0"
                className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-red-500"
              />
            </div>
            <button
              onClick={savePartyCost}
              disabled={partyCostSaving}
              className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              {partyCostSaving ? 'Saving…' : 'Set Target'}
            </button>
            {partyCostTarget > 0 && <span className="text-gray-600 text-xs">Current target: ${partyCostTarget.toLocaleString()}</span>}
          </div>

          {partyCostTarget > 0 && (() => {
            const { expenseCovered, expenseStillNeeded, surplus, poolData } = expenseRecovery
            const pct = Math.min(100, (expenseCovered / partyCostTarget) * 100)
            const fullyFunded = expenseStillNeeded === 0
            return (
              <div className="space-y-3">
                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className={fullyFunded ? 'text-green-400 font-semibold' : 'text-gray-400'}>
                      {fullyFunded ? 'Party expenses fully covered!' : `$${expenseCovered.toFixed(0)} of $${partyCostTarget.toLocaleString()} recovered`}
                    </span>
                    <span className="text-gray-500">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${fullyFunded ? 'bg-green-500' : 'bg-orange-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {!fullyFunded && <p className="text-gray-600 text-xs mt-1">${expenseStillNeeded.toFixed(0)} still needed</p>}
                  {surplus > 0 && <p className="text-green-600 text-xs mt-1">+${surplus.toFixed(0)} surplus returned to prize pools</p>}
                </div>
                {/* Per-pool breakdown */}
                {poolData.length > 0 && (
                  <div className="space-y-1">
                    {poolData.map(({ comp, paidCount: pc, fee, expenseContrib, actualPrizePool }) => {
                      if (pc === 0) return null
                      return (
                        <div key={comp.id} className="flex flex-wrap gap-x-3 gap-y-0 text-xs text-gray-600">
                          <span className="text-gray-500 font-medium">{comp.name}</span>
                          <span>{pc} paid × ${fee.toFixed(0)} × {comp.expense_cut_pct ?? 50}%</span>
                          <span className="text-orange-500">= ${expenseContrib.toFixed(0)} to expenses</span>
                          <span className="text-green-500">→ ${actualPrizePool.toFixed(0)} prize pool</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

          {partyCostTarget === 0 && (
            <p className="text-gray-700 text-xs italic">Set a dollar amount above to track party expense recovery across all pools.</p>
          )}
        </div>

        {showAddComp && (
          <div className="mb-4">
            <CompetitionForm
              initial={blankComp()}
              onSave={saveComp}
              onCancel={() => { setShowAddComp(false); setCompError('') }}
              saving={compSaving}
              error={compError}
              partyCostTarget={partyCostTarget}
              existingExpenseCovered={getExistingExpenseCovered(undefined)}
            />
          </div>
        )}

        {competitions.length === 0 && !showAddComp && (
          <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-600">
            No prize pools yet. Click <span className="text-red-500 font-semibold">+ Add Pool</span> to create your first one.
          </div>
        )}

        <div className="space-y-3">
          {competitions.map((comp) => {
            const playerCount = players.filter((p) => p.competition_id === comp.id).length
            const paidPlayerCount = players.filter((p) => p.competition_id === comp.id && p.paid).length
            const poolRecovery = expenseRecovery.poolData.find((d) => d.comp.id === comp.id)
            if (editingCompId === comp.id) {
              return (
                <div key={comp.id} className="bg-gray-900 rounded-xl p-5">
                  <p className="text-sm text-gray-400 mb-3">Editing: {comp.name}</p>
                  <CompetitionForm
                    initial={{ id: comp.id, name: comp.name, entry_fee: comp.entry_fee, description: comp.description ?? '', expense_cut_pct: String(comp.expense_cut_pct ?? 50), prize_splits: (comp.prize_splits ?? []).map((s) => ({ place: s.place, pct: String(s.pct) })) }}
                    onSave={saveComp}
                    onCancel={() => { setEditingCompId(null); setCompError('') }}
                    saving={compSaving}
                    error={compError}
                    partyCostTarget={partyCostTarget}
                    existingExpenseCovered={getExistingExpenseCovered(comp.id)}
                  />
                </div>
              )
            }
            return (
              <div key={comp.id} className="bg-gray-900 rounded-xl p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-white font-bold text-lg">{comp.name}</span>
                    <span className="text-red-400 font-black">{comp.entry_fee}</span>
                    <span className="text-gray-500 text-sm">{playerCount} player{playerCount !== 1 ? 's' : ''}</span>
                    {(comp.expense_cut_pct ?? 50) > 0 && <span className="text-gray-600 text-xs">{comp.expense_cut_pct ?? 50}% expense cut</span>}
                  </div>
                  {comp.description && <p className="text-gray-500 text-sm mt-0.5">{comp.description}</p>}
                  {paidPlayerCount > 0 && poolRecovery && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      <span className="text-gray-500">Pot: <span className="text-white font-semibold">${poolRecovery.totalPaid.toFixed(0)}</span></span>
                      {poolRecovery.expenseContrib > 0 && (
                        <span className="text-gray-500">Expenses: <span className="text-orange-400 font-semibold">${Math.min(poolRecovery.expenseContrib, partyCostTarget > 0 ? poolRecovery.expenseContrib : poolRecovery.expenseContrib).toFixed(0)}</span></span>
                      )}
                      <span className="text-gray-500">Prize pool: <span className="text-green-400 font-semibold">${poolRecovery.actualPrizePool.toFixed(0)}</span></span>
                      {(comp.prize_splits ?? []).map((s) => (
                        <span key={s.place} className="text-gray-600">{ordinal(s.place)}: <span className="text-green-500">${(poolRecovery.actualPrizePool * s.pct / 100).toFixed(0)}</span> ({s.pct}%)</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setEditingCompId(comp.id); setShowAddComp(false) }} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">Edit</button>
                  <button onClick={() => deleteComp(comp.id)} className="bg-gray-800 hover:bg-red-900 text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── SECTION 2: Fight Card Setup ───────────────────────────────────── */}
      <section className="mb-10">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <SectionHeader>Fight Card Setup</SectionHeader>
          <div className="flex gap-2">
            <button
              onClick={() => { setShowImport((v) => !v); setImportError(''); setImportEvents([]); setImportSuccess('') }}
              className="bg-orange-700 hover:bg-orange-600 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Import from Odds API
            </button>
            {!showAddFight && (
              <button onClick={() => { setShowAddFight(true); setEditingFightId(null) }} className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors">
                + Add Fight
              </button>
            )}
          </div>
        </div>

        {/* Import panel */}
        {showImport && (
          <div className="bg-gray-800 border border-orange-800/50 rounded-xl p-5 mb-4">
            <div className="flex justify-between items-start mb-3">
              <div>
                <p className="text-white font-bold">Import UFC Card from The Odds API</p>
                <p className="text-gray-500 text-xs mt-0.5">Fetches upcoming MMA events with American odds. Rounds default to 3 — edit main/co-main events to 5 after import.</p>
              </div>
              <button onClick={() => { setShowImport(false); setImportEvents([]); setImportError(''); setImportSuccess('') }} className="text-gray-600 hover:text-gray-400 text-xl leading-none">&times;</button>
            </div>

            {importEvents.length === 0 && !importLoading && !importError && (
              <button onClick={fetchImportCards} className="bg-orange-600 hover:bg-orange-500 text-white font-bold px-5 py-2 rounded-lg text-sm transition-colors">
                Fetch Upcoming Cards
              </button>
            )}

            {importLoading && <p className="text-gray-400 text-sm animate-pulse">Fetching from The Odds API…</p>}
            {importError && <p className="text-red-400 text-sm">{importError}</p>}
            {importSuccess && <p className="text-green-400 text-sm font-semibold">{importSuccess}</p>}

            {importEvents.length > 0 && (
              <div className="space-y-4 mt-3">
                {importEvents.map((group) => {
                  const d = new Date(group.date + 'T12:00:00')
                  const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
                  const sel = selectedFights[group.date] ?? new Set<number>()
                  const allChecked = sel.size === group.fights.length
                  return (
                    <div key={group.date} className="bg-gray-900 rounded-xl p-4">
                      <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
                        <div>
                          <p className="text-white font-bold">{label}</p>
                          <p className="text-gray-500 text-xs">{group.fights.length} fights with odds</p>
                        </div>
                        <button
                          onClick={() => importCard(group)}
                          disabled={importingSaving || sel.size === 0}
                          className="bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors"
                        >
                          {importingSaving ? 'Importing…' : `Import ${sel.size} Fight${sel.size !== 1 ? 's' : ''}`}
                        </button>
                      </div>
                      {/* Select all toggle */}
                      <label className="flex items-center gap-2 text-xs text-gray-500 mb-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={(e) => toggleAllFights(group.date, group.fights, e.target.checked)}
                          className="w-3.5 h-3.5 accent-orange-500"
                        />
                        {allChecked ? 'Deselect all' : 'Select all'}
                      </label>
                      <div className="space-y-2">
                        {group.fights.map((f, i) => (
                          <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sel.has(i)}
                              onChange={() => toggleFight(group.date, i)}
                              className="w-4 h-4 accent-orange-500 shrink-0"
                            />
                            <span className="text-white font-semibold">{f.fighter_a}</span>
                            <span className={`text-xs font-bold ${f.odds_a > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                              {f.odds_a > 0 ? `+${f.odds_a}` : f.odds_a}
                            </span>
                            <span className="text-gray-600">vs</span>
                            <span className="text-white font-semibold">{f.fighter_b}</span>
                            <span className={`text-xs font-bold ${f.odds_b > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                              {f.odds_b > 0 ? `+${f.odds_b}` : f.odds_b}
                            </span>
                            {f.book && <span className="text-gray-700 text-xs ml-1">{f.book}</span>}
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {showAddFight && (
          <div className="mb-4">
            <FightForm initial={{ ...blankFight(), fight_number: String(fights.length + 1) }} onSave={saveFight} onCancel={() => { setShowAddFight(false); setFightError('') }} saving={fightSaving} error={fightError} />
          </div>
        )}

        {fights.length === 0 && !showAddFight && (
          <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-600">
            No fights yet. Click <span className="text-red-500 font-semibold">+ Add Fight</span> to set up the card.
          </div>
        )}

        <div className="space-y-3">
          {fights.map((fight) => {
            if (editingFightId === fight.id) {
              return (
                <div key={fight.id} className="bg-gray-900 rounded-xl p-5">
                  <p className="text-sm text-gray-400 mb-3">Editing Fight {fight.fight_number}</p>
                  <FightForm
                    initial={{ id: fight.id, fight_number: String(fight.fight_number), fighter_a: fight.fighter_a, fighter_b: fight.fighter_b, odds_a: String(fight.odds_a), odds_b: String(fight.odds_b), rounds: String(fight.rounds) }}
                    onSave={saveFight}
                    onCancel={() => { setEditingFightId(null); setFightError('') }}
                    saving={fightSaving}
                    error={fightError}
                  />
                </div>
              )
            }
            return (
              <div key={fight.id} className="bg-gray-900 rounded-xl p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-gray-500 text-xs font-semibold">FIGHT {fight.fight_number}</span>
                    <StatusBadge status={fight.status} />
                    <span className="text-gray-600 text-xs">{fight.rounds}R</span>
                  </div>
                  <div className="text-white font-bold">
                    {fight.fighter_a} <span className={`text-sm font-bold ${fight.odds_a > 0 ? 'text-green-400' : 'text-gray-400'}`}>({formatOdds(fight.odds_a)})</span>
                    <span className="text-gray-600 mx-2">vs</span>
                    {fight.fighter_b} <span className={`text-sm font-bold ${fight.odds_b > 0 ? 'text-green-400' : 'text-gray-400'}`}>({formatOdds(fight.odds_b)})</span>
                  </div>
                </div>
                {fight.status === 'upcoming' && (
                  <div className="flex gap-2">
                    <button onClick={() => { setEditingFightId(fight.id); setShowAddFight(false) }} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">Edit</button>
                    <button onClick={() => deleteFight(fight.id)} className="bg-gray-800 hover:bg-red-900 text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">Delete</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── SECTION 3: Player Management ──────────────────────────────────── */}
      <section className="mb-10">
        <SectionHeader>Player Management</SectionHeader>
        <div className="bg-gray-900 rounded-xl overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-800">
                {['Name', 'Pool', 'Signed Up', 'Paid', 'Activated'].map((h) => (
                  <th key={h} className="text-left text-xs text-gray-500 uppercase tracking-wider px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-600">No players yet</td></tr>
              ) : (
                players.map((player) => {
                  const comp = competitions.find((c) => c.id === player.competition_id)
                  return (
                    <tr key={player.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-3 text-white font-semibold">{player.name}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-900/40 text-red-300">
                          {comp ? `${comp.name} (${comp.entry_fee})` : player.tier}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(player.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3"><Toggle checked={player.paid} onChange={() => togglePlayer(player.id, 'paid', !player.paid)} color="green" /></td>
                      <td className="px-4 py-3"><Toggle checked={player.activated} onChange={() => togglePlayer(player.id, 'activated', !player.activated)} color="blue" /></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── SECTION 4: Fight Status & Scoring ─────────────────────────────── */}
      <section className="mb-10">
        <SectionHeader>Fight Status &amp; Scoring</SectionHeader>
        <div className="space-y-4">
          {fights.length === 0 && <div className="bg-gray-900 rounded-xl p-6 text-center text-gray-600">Add fights above to manage their status.</div>}
          {fights.map((fight) => {
            const form = resultForms[fight.id]
            return (
              <div key={fight.id} className="bg-gray-900 rounded-xl p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-gray-500 text-xs font-semibold">FIGHT {fight.fight_number}</span>
                      <StatusBadge status={fight.status} />
                    </div>
                    <h3 className="text-white font-bold">{fight.fighter_a} <span className="text-gray-500">vs</span> {fight.fighter_b}</h3>
                    <p className="text-gray-500 text-sm">{fight.rounds}R &bull; {fight.fighter_a}: {formatOdds(fight.odds_a)} &bull; {fight.fighter_b}: {formatOdds(fight.odds_b)}</p>
                  </div>
                  {fight.status !== 'complete' && (
                    <button onClick={() => advanceStatus(fight)} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shrink-0">
                      {fight.status === 'upcoming' ? 'Lock Picks' : 'Mark Complete'} &rarr;
                    </button>
                  )}
                </div>

                {fight.status === 'complete' && form && (
                  <div className="mt-4 pt-4 border-t border-gray-800">
                    <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Enter Results</p>
                    <div className="flex flex-wrap gap-3 items-end">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Winner</label>
                        <select value={form.winner} onChange={(e) => setResult(fight.id, 'winner', e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500">
                          <option value="">Select winner</option>
                          <option value={fight.fighter_a}>{fight.fighter_a}</option>
                          <option value={fight.fighter_b}>{fight.fighter_b}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Method</label>
                        <select value={form.method} onChange={(e) => setResult(fight.id, 'method', e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500">
                          <option value="">Select method</option>
                          <option value="KO/TKO">KO/TKO</option>
                          <option value="Submission">Submission</option>
                          <option value="Decision">Decision</option>
                        </select>
                      </div>
                      {form.method && form.method !== 'Decision' && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Round</label>
                          <input type="number" min={1} max={fight.rounds} value={form.round} onChange={(e) => setResult(fight.id, 'round', e.target.value)} placeholder={`1–${fight.rounds}`} className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500" />
                        </div>
                      )}
                      <button onClick={() => saveResults(fight)} disabled={savingResults[fight.id] || !form.winner || !form.method} className="bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-bold transition-colors">
                        {savingResults[fight.id] ? 'Saving…' : 'Save & Score'}
                      </button>
                      {saveSuccess[fight.id] && <span className="text-green-400 text-sm font-semibold">Scores calculated!</span>}
                    </div>
                    {fight.result_winner && (
                      <p className="mt-3 text-sm text-gray-400">
                        Saved: <span className="text-white font-semibold">{fight.result_winner}</span> by <span className="text-white font-semibold">{fight.result_method}</span>{fight.result_round != null && ` (Round ${fight.result_round})`}
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
              <p className="text-gray-500 text-sm">Deletes all fights, players, picks, and scores. Prize pools are kept.</p>
            </div>
            {!resetConfirm ? (
              <button onClick={() => setResetConfirm(true)} className="bg-red-900/60 hover:bg-red-800 text-red-300 border border-red-700 font-bold px-5 py-2 rounded-lg text-sm transition-colors">Reset Event</button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-red-400 text-sm font-semibold">Are you sure?</span>
                <button onClick={resetEvent} disabled={resetting} className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors">{resetting ? 'Resetting…' : 'Yes, delete everything'}</button>
                <button onClick={() => setResetConfirm(false)} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors">Cancel</button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
