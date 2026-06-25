'use client'

import { useEffect, useState, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatOdds } from '@/lib/scoring'
import type { Competition, Fight, Pick, Player, PrizeSplit, Score, StoppageBet } from '@/lib/types'
import type { ImportedFight, ImportEventGroup } from '@/app/api/import-ufc-card/route'

function QRModal({ onClose }: { onClose: () => void }) {
  const url = typeof window !== 'undefined' ? `${window.location.origin}/play` : '/play'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl p-8 flex flex-col items-center gap-4 shadow-2xl max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-black font-black text-xl tracking-tight text-center">Scan to Play</p>
        <QRCodeSVG value={url} size={240} bgColor="#ffffff" fgColor="#000000" level="M" />
        <p className="text-gray-500 text-xs text-center break-all">{url}</p>
        <button
          onClick={onClose}
          className="mt-1 w-full bg-black text-white font-bold py-3 rounded-xl text-sm"
        >
          Close
        </button>
      </div>
    </div>
  )
}

// ─── shared primitives ─────────────────────────────────────────────────────


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

// ─── simulation ─────────────────────────────────────────────────────────────

type SimMethod = 'KO/TKO' | 'Submission' | 'Decision'
interface SimPlayer {
  id: string; name: string; competition_id: string
  picks: Record<string, { winner_pick: string; method_pick: SimMethod; round_pick: number | null }>
}
interface SimResult { fight_id: string; fight_number: number; winner: string; method: SimMethod; round: number | null }

const SIM_NAMES = [
  'Alex Johnson','Sam Williams','Jordan Smith','Casey Brown','Morgan Davis',
  'Riley Wilson','Blake Martinez','Taylor Anderson','Drew Thompson','Quinn Garcia',
  'Harper Lee','Logan Moore','Avery Jackson','Parker White','Reese Harris',
  'Charlie Clark','Jamie Lewis','Skylar Walker','Finley Hall','Peyton Allen',
  'Rowan Young','Sage King','River Scott','Phoenix Green','Dakota Baker',
  'Frankie Torres','Jesse Reed','Kendall Cook','Lennox Phillips','Marley Evans',
  'Sasha Bell','Nico Cruz','Remy Stone','Avery Flores','Carmen Vega',
  'Dani Reyes','Eli Shaw','Fiona Brooks','Gus Ortega','Hana Patel',
]
const SIM_METHODS: SimMethod[] = ['KO/TKO','KO/TKO','KO/TKO','Submission','Submission','Decision','Decision','Decision','Decision','Decision']
function simRand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function simRandInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min }
function simWins(oddsA: number, _oddsB: number): boolean {
  const probA = oddsA > 0 ? 100 / (oddsA + 100) : Math.abs(oddsA) / (Math.abs(oddsA) + 100)
  return Math.random() < probA
}
function simCalcTotal(player: SimPlayer, results: SimResult[], fights: Fight[]): number {
  return results.reduce((sum, res) => {
    const pick = player.picks[res.fight_id]
    const fight = fights.find(f => f.id === res.fight_id)
    if (!pick || !fight) return sum
    if (pick.winner_pick !== res.winner) return sum
    const odds = pick.winner_pick === fight.fighter_a ? fight.odds_a : fight.odds_b
    let pts = odds > 0 ? odds : odds < 0 ? Math.round((100 / Math.abs(odds)) * 100) : 100
    if (pick.method_pick === res.method) {
      pts += res.method === 'KO/TKO' ? 100 : res.method === 'Submission' ? 150 : 50
      if (res.method !== 'Decision' && pick.round_pick === res.round) pts += 100
    }
    return sum + pts
  }, 0)
}

function SimulationPanel({ competitions, fights, partyCostTarget, onExit }: {
  competitions: Competition[]; fights: Fight[]; partyCostTarget: number; onExit: () => void
}) {
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [players, setPlayers] = useState<SimPlayer[]>([])
  const [results, setResults] = useState<SimResult[]>([])
  const [simRan, setSimRan] = useState(false)

  function generatePlayers() {
    const pool = [...SIM_NAMES].sort(() => Math.random() - 0.5)
    let nameIdx = 0
    const newPlayers: SimPlayer[] = []
    competitions.forEach(comp => {
      const n = Math.max(0, Math.min(200, parseInt(counts[comp.id] || '0', 10)))
      for (let i = 0; i < n; i++) {
        const name = nameIdx < pool.length ? pool[nameIdx++] : `Player ${nameIdx++ + 1}`
        const picks: SimPlayer['picks'] = {}
        fights.forEach(fight => {
          const aWins = simWins(fight.odds_a, fight.odds_b)
          const winner = aWins ? fight.fighter_a : fight.fighter_b
          const method = simRand(SIM_METHODS)
          picks[fight.id] = { winner_pick: winner, method_pick: method, round_pick: method !== 'Decision' ? simRandInt(1, fight.rounds) : null }
        })
        newPlayers.push({ id: `sim-${comp.id}-${i}`, name, competition_id: comp.id, picks })
      }
    })
    setPlayers(newPlayers)
    setResults([])
    setSimRan(false)
  }

  function runSim() {
    const newResults: SimResult[] = fights.map(fight => {
      const aWins = simWins(fight.odds_a, fight.odds_b)
      const winner = aWins ? fight.fighter_a : fight.fighter_b
      const method = simRand(SIM_METHODS)
      return { fight_id: fight.id, fight_number: fight.fight_number, winner, method, round: method !== 'Decision' ? simRandInt(1, fight.rounds) : null }
    })
    setResults(newResults)
    setSimRan(true)
  }

  const totalCount = Object.values(counts).reduce((s, v) => s + (parseInt(v) || 0), 0)

  return (
    <div className="mb-10 rounded-2xl border-2 border-yellow-600/60 overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-6 py-4 bg-yellow-950/60 border-b border-yellow-700/40">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-400" /></span>
          <span className="text-yellow-300 font-black text-lg tracking-wider">SIMULATION MODE</span>
          <span className="text-yellow-800 text-xs hidden sm:inline">no real data is affected</span>
        </div>
        <button onClick={onExit} className="border border-yellow-700 text-yellow-400 hover:bg-yellow-900/60 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors">Exit</button>
      </div>

      <div className="p-6 space-y-8 bg-yellow-950/10">
        {fights.length === 0 && (
          <p className="text-yellow-600 text-sm">Add fights in Fight Card Setup first — simulation needs fights to work with.</p>
        )}

        {/* Step 1 */}
        {fights.length > 0 && (
          <div>
            <p className="text-xs text-yellow-700 font-bold uppercase tracking-widest mb-3">Step 1 — How many entries per pool?</p>
            <div className="flex flex-wrap gap-4 mb-4">
              {competitions.map(comp => (
                <div key={comp.id} className="bg-gray-900 rounded-xl px-4 py-3 border border-gray-800 flex items-center gap-3">
                  <div>
                    <div className="text-white font-bold text-sm">{comp.name}</div>
                    <div className="text-red-400 text-xs font-black">{comp.entry_fee}</div>
                  </div>
                  <input
                    type="number" min={0} max={200}
                    value={counts[comp.id] || ''}
                    onChange={e => setCounts(p => ({ ...p, [comp.id]: e.target.value }))}
                    placeholder="0"
                    className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm text-center focus:outline-none focus:border-yellow-500"
                  />
                  <span className="text-gray-500 text-xs">entries</span>
                </div>
              ))}
            </div>
            <button
              onClick={generatePlayers}
              disabled={totalCount === 0}
              className="bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-black font-black px-6 py-2.5 rounded-xl text-sm transition-colors"
            >
              Generate {totalCount > 0 ? `${totalCount} Random Entries` : 'Entries'}
            </button>
            {players.length > 0 && (
              <span className="ml-3 text-yellow-600 text-sm font-semibold">{players.length} entries ready</span>
            )}
          </div>
        )}

        {/* Step 2 */}
        {players.length > 0 && (
          <div>
            <p className="text-xs text-yellow-700 font-bold uppercase tracking-widest mb-3">Step 2 — Simulate the fights</p>
            <button
              onClick={runSim}
              className="bg-red-600 hover:bg-red-500 text-white font-black px-6 py-2.5 rounded-xl text-sm transition-colors"
            >
              {simRan ? 'Re-run Simulation' : 'Run Fight Simulation'}
            </button>
            {simRan && <span className="ml-3 text-gray-600 text-xs">Each run picks new random outcomes weighted by odds</span>}
          </div>
        )}

        {/* Results */}
        {simRan && results.length > 0 && (() => {
          // Compute cross-pool expense recovery
          let totalExpContrib = 0
          competitions.forEach(c => {
            const cnt = players.filter(p => p.competition_id === c.id).length
            totalExpContrib += cnt * parseFee(c.entry_fee) * ((c.expense_cut_pct ?? 50) / 100)
          })
          const surplus = partyCostTarget > 0 ? Math.max(0, totalExpContrib - partyCostTarget) : 0

          return (
            <div className="space-y-6">
              {/* Fight outcomes */}
              <div>
                <p className="text-xs text-yellow-700 font-bold uppercase tracking-widest mb-3">Simulated Outcomes</p>
                <div className="flex flex-wrap gap-2">
                  {results.map(res => (
                    <div key={res.fight_id} className="bg-gray-900 rounded-xl px-3 py-2 border border-gray-800 text-xs">
                      <span className="text-gray-600 mr-1.5">F{res.fight_number}</span>
                      <span className="text-white font-bold">{res.winner}</span>
                      <span className="text-orange-400 ml-1.5">{res.method}{res.round != null ? ` R${res.round}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Leaderboard per competition */}
              {competitions.map(comp => {
                const compPlayers = players.filter(p => p.competition_id === comp.id)
                if (compPlayers.length === 0) return null
                const board = compPlayers
                  .map(p => ({ player: p, total: simCalcTotal(p, results, fights) }))
                  .sort((a, b) => b.total - a.total)

                const fee = parseFee(comp.entry_fee)
                const expCut = (comp.expense_cut_pct ?? 50) / 100
                const thisExpContrib = compPlayers.length * fee * expCut
                const thisSurplus = totalExpContrib > 0 ? (thisExpContrib / totalExpContrib) * surplus : 0
                const prizePool = compPlayers.length * fee * (1 - expCut) + thisSurplus
                const splits = comp.prize_splits ?? []

                return (
                  <div key={comp.id}>
                    <div className="flex flex-wrap items-baseline gap-3 mb-2">
                      <p className="text-xs text-yellow-700 font-bold uppercase tracking-widest">{comp.name} Results</p>
                      <span className="text-gray-600 text-xs">{compPlayers.length} players · <span className="text-green-500 font-semibold">${prizePool.toFixed(0)} prize pool</span></span>
                      {partyCostTarget > 0 && <span className="text-orange-600 text-xs">${Math.min(thisExpContrib, partyCostTarget).toFixed(0)} to expenses</span>}
                    </div>
                    <div className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
                      <table className="w-full text-sm">
                        <tbody>
                          {board.map(({ player, total }, idx) => {
                            const rank = idx + 1
                            const split = splits.find(s => s.place === rank)
                            const payout = split ? prizePool * split.pct / 100 : null
                            return (
                              <tr key={player.id} className={`border-b border-gray-800/40 ${rank === 1 ? 'bg-yellow-900/15' : rank <= 3 ? 'bg-gray-800/20' : ''}`}>
                                <td className="px-3 py-2.5 text-gray-600 w-8 font-bold text-xs">{rank}</td>
                                <td className="px-2 py-2.5 text-white font-semibold">{player.name}</td>
                                <td className="px-2 py-2.5 text-right font-black text-green-400">{total} pts</td>
                                <td className="px-3 py-2.5 text-right w-20">
                                  {payout != null ? (
                                    <span className={`font-black ${rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-gray-300' : rank === 3 ? 'text-amber-600' : 'text-green-500'}`}>
                                      ${payout.toFixed(0)}
                                    </span>
                                  ) : <span className="text-gray-700">—</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      {splits.length > 0 && (
                        <div className="px-4 py-2.5 border-t border-gray-800 flex flex-wrap gap-4">
                          {splits.map(s => (
                            <span key={s.place} className="text-xs text-gray-600">
                              {ordinal(s.place)}{' '}
                              <span className={`font-bold ${s.place === 1 ? 'text-yellow-400' : s.place === 2 ? 'text-gray-300' : 'text-amber-600'}`}>
                                ${(prizePool * s.pct / 100).toFixed(0)}
                              </span>
                              <span className="text-gray-700 ml-0.5">({s.pct}%)</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
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

  // simulation mode
  const [simMode, setSimMode] = useState(false)

  // QR code
  const [showQR, setShowQR] = useState(false)

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
  const [fightRoundsOverrides, setFightRoundsOverrides] = useState<Record<string, 3 | 5>>({})

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

  // stoppage jackpot
  const [stoppageBets, setStoppageBets] = useState<StoppageBet[]>([])
  const [scores, setScores] = useState<Score[]>([])
  const [stopActual, setStopActual] = useState<Record<string, { round: string; minute: string; second: string }>>({})
  const [stoppageWinners, setStoppageWinners] = useState<Record<string, string>>({})

  // reset
  const [resetting, setResetting] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)

  // expanded result forms (fights with existing results are collapsed by default)
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set())

  // tab navigation
  const [activeTab, setActiveTab] = useState<'fights' | 'players' | 'money' | 'setup'>('fights')

  // manage players
  const [allPicks, setAllPicks] = useState<Pick[]>([])
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null)
  const [pickEdits, setPickEdits] = useState<Record<string, Record<string, { winner: string; method: string; round: string }>>>({})
  const [betEdits, setBetEdits] = useState<Record<string, { round: string; minute: string; second: string }>>({})
  const [savingPickId, setSavingPickId] = useState('')
  const [savingBetId, setSavingBetId] = useState('')
  const [clearingPlayer, setClearingPlayer] = useState('')
  const [payingPlayer, setPayingPlayer] = useState('')

  // event settings
  const [eventTitle, setEventTitle] = useState('')
  const [eventTitleInput, setEventTitleInput] = useState('')
  const [eventTitleSaving, setEventTitleSaving] = useState(false)
  const [posterUploading, setPosterUploading] = useState(false)
  const [posterUrl, setPosterUrl] = useState('')
  const [posterError, setPosterError] = useState('')

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setDataLoading(true)
    const supabase = getSupabaseBrowser()
    const [{ data: compsData }, { data: playersData }, { data: fightsData }, { data: stoppageBetsData }, { data: scoresData }, { data: picksData }, settingsRes] = await Promise.all([
      supabase.from('competitions').select('*').order('created_at'),
      supabase.from('players').select('*').order('created_at'),
      supabase.from('fights').select('*').order('fight_number'),
      supabase.from('stoppage_bets').select('*').order('created_at'),
      supabase.from('scores').select('*'),
      supabase.from('picks').select('*'),
      fetch('/api/event-settings'),
    ])
    if (compsData) setCompetitions(compsData)
    if (playersData) setPlayers(playersData)
    if (stoppageBetsData) setStoppageBets(stoppageBetsData)
    if (scoresData) setScores(scoresData)
    if (picksData) setAllPicks(picksData)
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
      if (!silent) setPartyCostInput(target > 0 ? String(target) : '')
      if (settings.event_title) { setEventTitle(settings.event_title); if (!silent) setEventTitleInput(settings.event_title) }
      if (settings.poster_url) setPosterUrl(settings.poster_url)
    }
    if (!silent) setDataLoading(false)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('fn_admin_authed') === 'true') {
      setAuthed(true)
      loadData()
    }
  }, [loadData])

  // background auto-refresh every 15 seconds + on tab focus
  useEffect(() => {
    if (!authed) return
    const interval = setInterval(() => loadData(true), 15000)
    const onVisible = () => { if (document.visibilityState === 'visible') loadData(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [authed, loadData])

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

  async function saveEventTitle() {
    setEventTitleSaving(true)
    await fetch('/api/event-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_title: eventTitleInput }),
    })
    setEventTitle(eventTitleInput)
    setEventTitleSaving(false)
  }

  async function uploadPoster(file: File) {
    setPosterUploading(true)
    setPosterError('')
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/upload-poster', { method: 'POST', body: fd })
    const data = await res.json()
    if (data.url) setPosterUrl(data.url)
    else setPosterError(data.error ?? 'Upload failed. Make sure Supabase Storage is enabled and the event_settings table has a poster_url column.')
    setPosterUploading(false)
  }

  async function markPlayerAllPaid(playerName: string, pickEmPlayerId: string | null, betIds: string[]) {
    setPayingPlayer(playerName)
    const calls: Promise<void>[] = []
    if (pickEmPlayerId) calls.push(markPickEmPaid(pickEmPlayerId))
    for (const betId of betIds) calls.push(markJackpotPaid(betId))
    await Promise.all(calls)
    setPayingPlayer('')
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

  async function lockAllFights() {
    if (!confirm("Lock all fights? No new pick'em entries will be accepted.")) return
    setFights((prev) => prev.map((f) => f.status === 'upcoming' ? { ...f, status: 'locked' as const } : f))
    await fetch('/api/lock-all-fights', { method: 'POST' })
  }

  async function advanceStatus(fight: Fight) {
    if (fight.status !== 'locked') return
    setFights((prev) => prev.map((f) => f.id === fight.id ? { ...f, status: 'complete' as const } : f))
    await fetch('/api/update-fight-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fight_id: fight.id, status: 'complete' }) })
  }

  // ── players ───────────────────────────────────────────────────────────────

  async function activatePlayer(id: string, value: boolean) {
    setPlayers((prev) => prev.map((p) => p.id === id ? { ...p, paid: value, activated: value } : p))
    await Promise.all([
      fetch('/api/update-player', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: id, field: 'paid', value }) }),
      fetch('/api/update-player', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: id, field: 'activated', value }) }),
    ])
  }

  // ── stoppage jackpot ─────────────────────────────────────────────────────

  async function toggleStoppageBetting(fightId: string, open: boolean) {
    setFights((prev) => prev.map((f) => f.id === fightId ? { ...f, stoppage_bet_open: open } : f))
    await fetch('/api/update-fight-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fight_id: fightId, stoppage_bet_open: open }),
    })
  }

  async function saveFightBetFee(fightId: string, fee: string) {
    setFights((prev) => prev.map((f) => f.id === fightId ? { ...f, stoppage_bet_fee: fee } : f))
    await fetch('/api/update-fight-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fight_id: fightId, stoppage_bet_fee: fee }),
    })
  }

  async function activateStoppageBet(betId: string, value: boolean) {
    setStoppageBets((prev) => prev.map((b) => b.id === betId ? { ...b, paid: value, activated: value } : b))
    await fetch('/api/activate-stoppage-bet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet_id: betId, value }),
    })
  }

  async function markPickEmPaid(playerId: string) {
    setPlayers((prev) => prev.map((p) => p.id === playerId ? { ...p, payout_paid: true } : p))
    await fetch('/api/update-player', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: playerId, field: 'payout_paid', value: true }) })
  }

  async function markJackpotPaid(betId: string) {
    setStoppageBets((prev) => prev.map((b) => b.id === betId ? { ...b, jackpot_paid: true } : b))
    await fetch('/api/mark-jackpot-paid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bet_id: betId, paid: true }) })
  }

  const [payingAll, setPayingAll] = useState(false)

  async function payAllPayouts(playerIds: string[], betIds: string[]) {
    setPayingAll(true)
    await Promise.all([
      ...playerIds.map((id) => markPickEmPaid(id)),
      ...betIds.map((id) => markJackpotPaid(id)),
    ])
    setPayingAll(false)
  }

  async function saveFullResult(fight: Fight) {
    const form = resultForms[fight.id]
    if (!form?.winner || !form?.method) return
    setSavingResults((prev) => ({ ...prev, [fight.id]: true }))

    // Save result + compute pick'em scores
    await fetch('/api/save-results', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fight_id: fight.id, result_winner: form.winner, result_method: form.method, result_round: form.method !== 'Decision' && form.round ? parseInt(form.round, 10) : null }),
    })

    // Resolve stoppage jackpot if not a decision
    if (form.method !== 'Decision') {
      const a = stopActual[fight.id]
      const round = parseInt(a?.round || '0', 10)
      const minute = parseInt(a?.minute || '0', 10)
      const second = parseInt(a?.second || '0', 10)
      if (round) {
        const res = await fetch('/api/resolve-stoppage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fight_id: fight.id, actual_round: round, actual_minute: minute, actual_second: second }),
        })
        const result = await res.json()
        if (result.winner) {
          const playerName = players.find((p) => p.id === result.winner.player_id)?.name ?? 'Unknown'
          const m = result.winner.minute_pick - 1
          const s = String(result.winner.second_pick).padStart(2, '0')
          setStoppageWinners((prev) => ({ ...prev, [fight.id]: `${playerName} — R${result.winner.round_pick} ${m}:${s}` }))
        } else {
          setStoppageWinners((prev) => ({ ...prev, [fight.id]: `No winner — no bets at or before R${round} ${minute}:${String(second).padStart(2, '0')}` }))
        }
      }
    } else if (stoppageBets.some((b) => b.fight_id === fight.id && b.activated)) {
      setStoppageWinners((prev) => ({ ...prev, [fight.id]: 'No winner — Decision' }))
    }

    setSavingResults((prev) => ({ ...prev, [fight.id]: false }))
    setExpandedResults((prev) => { const s = new Set(prev); s.delete(fight.id); return s })
    await loadData(true)
  }

  async function rolloverJackpot(fromFightId: string, toFightId: string) {
    const res = await fetch('/api/jackpot-rollover', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_fight_id: fromFightId, to_fight_id: toFightId }),
    })
    if (res.ok) await loadData()
  }

  // ── results ───────────────────────────────────────────────────────────────

  function setResult(fightId: string, field: keyof ResultFormState, value: string) {
    setResultForms((prev) => ({ ...prev, [fightId]: { ...prev[fightId], [field]: value, ...(field === 'method' && value === 'Decision' ? { round: '' } : {}) } }))
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
    const fightsToImport = group.fights
      .map((f, i) => ({ fight: f, index: i }))
      .filter(({ index }) => selected.has(index))
      .map(({ fight, index }) => ({ ...fight, rounds: fightRoundsOverrides[`${group.date}-${index}`] ?? 3 }))
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

  // ── manage players ────────────────────────────────────────────────────────

  function getPickEdit(playerId: string, fightId: string) {
    if (pickEdits[playerId]?.[fightId]) return pickEdits[playerId][fightId]
    const pick = allPicks.find((p) => p.player_id === playerId && p.fight_id === fightId)
    return { winner: pick?.winner_pick ?? '', method: pick?.method_pick ?? '', round: String(pick?.round_pick ?? '') }
  }

  function setPickEditField(playerId: string, fightId: string, field: string, value: string) {
    setPickEdits((prev) => ({
      ...prev,
      [playerId]: { ...prev[playerId], [fightId]: { ...getPickEdit(playerId, fightId), [field]: value } },
    }))
  }

  function getBetEdit(bet: StoppageBet) {
    return betEdits[bet.id] ?? { round: String(bet.round_pick), minute: String(bet.minute_pick - 1), second: String(bet.second_pick) }
  }

  async function savePickEdit(playerId: string, fightId: string, edit: { winner: string; method: string; round: string }) {
    const key = `${playerId}-${fightId}`
    setSavingPickId(key)
    await fetch('/api/admin-update-pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: playerId, fight_id: fightId, winner_pick: edit.winner, method_pick: edit.method, round_pick: edit.round ? parseInt(edit.round) : null }),
    })
    await loadData(true)
    setSavingPickId('')
  }

  async function saveBetEdit(betId: string, edit: { round: string; minute: string; second: string }) {
    setSavingBetId(betId)
    await fetch('/api/admin-update-stoppage-bet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet_id: betId, round_pick: parseInt(edit.round), minute_pick: parseInt(edit.minute) + 1, second_pick: parseInt(edit.second) }),
    })
    await loadData(true)
    setSavingBetId('')
  }

  async function clearPlayerData(playerId: string, mode: 'picks' | 'bet' | 'all') {
    setClearingPlayer(`${playerId}-${mode}`)
    await fetch('/api/admin-clear-picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: playerId, mode }),
    })
    if (mode === 'picks' || mode === 'all') {
      setPickEdits((prev) => { const next = { ...prev }; delete next[playerId]; return next })
    }
    await loadData(true)
    setClearingPlayer('')
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
      {showQR && <QRModal onClose={() => setShowQR(false)} />}
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black text-white">UFC FIGHT NIGHT &mdash; ADMIN</h1>
          <p className="text-gray-500 text-sm mt-0.5">Competitions, fights, players &amp; scoring</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowQR(true)}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
          >
            QR Code
          </button>
          <button
            onClick={() => setSimMode(v => !v)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors border ${simMode ? 'bg-yellow-500 border-yellow-400 text-black' : 'bg-gray-800 border-gray-700 text-yellow-400 hover:border-yellow-600'}`}
          >
            {simMode ? '⚡ Sim Mode ON' : '⚡ Simulation'}
          </button>
          <button onClick={() => loadData()} disabled={dataLoading} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            {dataLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Simulation Panel */}
      {simMode && (
        <SimulationPanel
          competitions={competitions}
          fights={fights}
          partyCostTarget={partyCostTarget}
          onExit={() => setSimMode(false)}
        />
      )}

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

      {/* Tab navigation */}
      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 mb-8">
        {(['fights', 'players', 'money', 'setup'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
              activeTab === tab ? 'bg-white text-black' : 'text-gray-500 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Event Info ───────────────────────────────────────────────────── */}
      {activeTab === 'setup' && <section className="mb-8">
        <SectionHeader>Event Info</SectionHeader>
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-5">
          {/* Event Title */}
          <div>
            <label className="block text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">Event Title</label>
            <p className="text-xs text-gray-600 mb-2">Shown as the heading on the player page. Leave blank for the default.</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={eventTitleInput}
                onChange={(e) => setEventTitleInput(e.target.value)}
                placeholder="e.g. UFC 329: McGregor vs Holloway II"
                className={inputCls}
              />
              <button
                onClick={saveEventTitle}
                disabled={eventTitleSaving}
                className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
              >
                {eventTitleSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
            {eventTitle && <p className="text-gray-600 text-xs mt-1.5">Current: <span className="text-gray-400">{eventTitle}</span></p>}
          </div>

          {/* Poster Upload */}
          <div>
            <label className="block text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">Background Poster</label>
            <p className="text-xs text-gray-600 mb-2">Shown as a subtle ambient background on all pages.</p>
            <div className="flex items-center gap-3">
              <label className={`inline-flex items-center gap-2 cursor-pointer bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors ${posterUploading ? 'opacity-50 cursor-wait' : ''}`}>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={posterUploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPoster(f) }}
                />
                {posterUploading ? 'Uploading…' : 'Upload Image'}
              </label>
              {posterUrl && !posterUploading && (
                <span className="text-green-500 text-xs font-semibold">✓ Poster active</span>
              )}
              {posterError && <p className="text-red-400 text-xs mt-2">{posterError}</p>}
            </div>
          </div>
        </div>
      </section>}

      {/* ── SECTION 1: Prize Pool Setup ───────────────────────────────────── */}
      {activeTab === 'setup' && <section className="mb-10">
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
      </section>}

      {/* ── SECTION 2: Fight Card Setup ───────────────────────────────────── */}
      {activeTab === 'fights' && <section className="mb-10">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <SectionHeader>Fights</SectionHeader>
          <div className="flex flex-wrap gap-2">
            {fights.some((f) => f.status === 'upcoming') && (
              <button
                onClick={lockAllFights}
                className="bg-yellow-600 hover:bg-yellow-500 text-black font-black px-4 py-2 rounded-lg text-sm transition-colors"
              >
                🔒 Lock All
              </button>
            )}
            <button
              onClick={() => { setShowImport((v) => !v); setImportError(''); setImportEvents([]); setImportSuccess('') }}
              className="bg-orange-700 hover:bg-orange-600 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Import
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
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault()
                                const key = `${group.date}-${i}`
                                setFightRoundsOverrides((prev) => ({ ...prev, [key]: prev[key] === 5 ? 3 : 5 }))
                              }}
                              className={`ml-auto text-xs font-bold px-2 py-0.5 rounded border transition-colors ${
                                (fightRoundsOverrides[`${group.date}-${i}`] ?? 3) === 5
                                  ? 'border-yellow-600 text-yellow-400 bg-yellow-900/20'
                                  : 'border-gray-700 text-gray-500 hover:border-gray-500'
                              }`}
                            >
                              {(fightRoundsOverrides[`${group.date}-${i}`] ?? 3) === 5 ? '5R' : '3R'}
                            </button>
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
            const form = resultForms[fight.id]
            const fightBetCount = stoppageBets.filter((b) => b.fight_id === fight.id).length
            return (
              <div key={fight.id} className="bg-gray-900 rounded-xl overflow-hidden">
                {/* Fight header */}
                <div className="p-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
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
                  <div className="flex items-center gap-2 shrink-0">
                    {fight.status === 'upcoming' && (
                      <>
                        <button onClick={() => { setEditingFightId(fight.id); setShowAddFight(false) }} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">Edit</button>
                        <button onClick={() => deleteFight(fight.id)} className="bg-gray-800 hover:bg-red-900 text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">Delete</button>
                      </>
                    )}
                    {fight.status === 'locked' && (
                      <button onClick={() => advanceStatus(fight)} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                        Mark Complete →
                      </button>
                    )}
                  </div>
                </div>

                {/* Jackpot controls — upcoming + locked */}
                {fight.status !== 'complete' && (
                  <div className="px-5 py-3 border-t border-gray-800/60 bg-gray-800/20 flex flex-wrap items-center gap-3">
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Jackpot</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-600">$</span>
                      <input
                        type="text"
                        defaultValue={fight.stoppage_bet_fee ?? '20'}
                        onBlur={(e) => saveFightBetFee(fight.id, e.target.value)}
                        className="w-14 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-yellow-600"
                      />
                    </div>
                    <button
                      onClick={() => toggleStoppageBetting(fight.id, !fight.stoppage_bet_open)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${fight.stoppage_bet_open ? 'bg-green-800 hover:bg-red-900 text-green-200' : 'bg-gray-800 hover:bg-green-900 text-gray-400 hover:text-green-300'}`}
                    >
                      {fight.stoppage_bet_open ? '● OPEN — tap to close' : '○ Open Betting'}
                    </button>
                    {fightBetCount > 0 && <span className="text-xs text-gray-500">{fightBetCount} bet{fightBetCount !== 1 ? 's' : ''}</span>}
                  </div>
                )}

                {/* Results + Jackpot resolution — complete */}
                {fight.status === 'complete' && form && (() => {
                  const isCollapsed = fight.result_winner != null && !expandedResults.has(fight.id)

                  if (isCollapsed) {
                    return (
                      <div className="px-5 py-3 border-t border-gray-800 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-green-400">
                            ✓ {fight.result_winner} by {fight.result_method}{fight.result_round != null ? ` (R${fight.result_round})` : ''}
                          </p>
                          {stoppageWinners[fight.id] ? (
                            <p className={`text-xs mt-0.5 ${stoppageWinners[fight.id].startsWith('No winner') ? 'text-gray-500' : 'text-yellow-400'}`}>
                              Jackpot: {stoppageWinners[fight.id]}
                            </p>
                          ) : fight.stoppage_actual_round != null ? (
                            <p className="text-xs text-gray-600 mt-0.5">
                              Stoppage: R{fight.stoppage_actual_round} {fight.stoppage_actual_minute}:{String(fight.stoppage_actual_second ?? 0).padStart(2, '0')}
                            </p>
                          ) : null}
                          {stoppageWinners[fight.id]?.startsWith('No winner') && (() => {
                            const nextFight = fights.find((f) => f.fight_number > fight.fight_number && f.status !== 'complete')
                            if (!nextFight) return null
                            const activatedBets = stoppageBets.filter((b) => b.fight_id === fight.id && b.activated)
                            const fee = parseFloat(fight.stoppage_bet_fee ?? '20') || 20
                            const rolloverAmt = activatedBets.length * fee + (fight.jackpot_rollover ?? 0)
                            return (
                              <button onClick={() => rolloverJackpot(fight.id, nextFight.id)} className="mt-2 bg-orange-700 hover:bg-orange-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition-colors">
                                Roll ${rolloverAmt} → Fight {nextFight.fight_number}
                              </button>
                            )
                          })()}
                        </div>
                        <button
                          onClick={() => {
                            setExpandedResults((prev) => { const s = new Set(prev); s.add(fight.id); return s })
                            setResultForms((prev) => ({ ...prev, [fight.id]: { winner: fight.result_winner ?? '', method: fight.result_method ?? '', round: fight.result_round?.toString() ?? '' } }))
                            if (fight.stoppage_actual_round != null) {
                              setStopActual((prev) => ({ ...prev, [fight.id]: { round: String(fight.stoppage_actual_round), minute: String(fight.stoppage_actual_minute ?? ''), second: String(fight.stoppage_actual_second ?? '0') } }))
                            }
                          }}
                          className="text-xs text-gray-600 hover:text-gray-300 shrink-0 pt-0.5"
                        >
                          Edit
                        </button>
                      </div>
                    )
                  }

                  const stop = stopActual[fight.id] ?? { round: '', minute: '', second: '0' }
                  const roundSelected = Boolean(stop.round)
                  const minuteSelected = stop.minute !== '' && stop.minute !== undefined
                  const curSecond = parseInt(stop.second || '0', 10)

                  return (
                    <div className="px-5 py-5 border-t border-gray-800 space-y-4">
                      {/* Winner buttons */}
                      <div>
                        <p className="text-xs text-gray-600 uppercase tracking-wider font-semibold mb-2">Winner</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[fight.fighter_a, fight.fighter_b].map((fighter) => (
                            <button
                              key={fighter}
                              onClick={() => setResult(fight.id, 'winner', fighter)}
                              className={`py-3 px-4 rounded-xl font-bold text-sm transition-colors ${form.winner === fighter ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}
                            >
                              {fighter}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Method buttons */}
                      <div>
                        <p className="text-xs text-gray-600 uppercase tracking-wider font-semibold mb-2">Method</p>
                        <div className="grid grid-cols-3 gap-2">
                          {(['KO/TKO', 'Submission', 'Decision'] as const).map((method) => (
                            <button
                              key={method}
                              onClick={() => setResult(fight.id, 'method', method)}
                              className={`py-2.5 rounded-xl font-bold text-sm transition-colors ${form.method === method ? 'bg-white text-black' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}
                            >
                              {method}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Stoppage time — 3-step flow matching player UI */}
                      {form.method && form.method !== 'Decision' && (
                        <div>
                          <p className="text-xs text-gray-600 uppercase tracking-wider font-semibold mb-3">When did it end?</p>

                          {/* Step 1: Round */}
                          {!roundSelected && (
                            <div>
                              <p className="text-xs text-gray-500 mb-2">Select a round</p>
                              <div className="flex gap-2">
                                {Array.from({ length: fight.rounds }, (_, i) => i + 1).map((r) => (
                                  <button
                                    key={r}
                                    onClick={() => setStopActual((prev) => ({ ...prev, [fight.id]: { round: String(r), minute: '', second: '0' } }))}
                                    className="flex-1 py-3 rounded-xl border-2 border-gray-700 text-white font-bold hover:border-yellow-600 hover:bg-yellow-900/20 transition-all"
                                  >
                                    Round {r}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Step 2: Minute */}
                          {roundSelected && !minuteSelected && (
                            <div>
                              <div className="flex items-center gap-3 mb-3">
                                <button onClick={() => setStopActual((prev) => ({ ...prev, [fight.id]: { round: '', minute: '', second: '0' } }))} className="text-gray-500 hover:text-gray-300 text-sm">← Back</button>
                                <p className="text-xs text-gray-500 uppercase tracking-wider">Round {stop.round} — tap a minute</p>
                              </div>
                              <div className="flex gap-2">
                                {[0, 1, 2, 3, 4].map((m) => (
                                  <button
                                    key={m}
                                    onClick={() => setStopActual((prev) => ({ ...prev, [fight.id]: { ...prev[fight.id], minute: String(m), second: '0' } }))}
                                    className="flex-1 py-3 rounded-xl border-2 border-gray-700 text-white font-bold hover:border-yellow-600 hover:bg-yellow-900/20 transition-all text-base"
                                  >
                                    {m}:__
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Step 3: Second slider */}
                          {roundSelected && minuteSelected && (
                            <div>
                              <div className="flex items-center gap-3 mb-4">
                                <button onClick={() => setStopActual((prev) => ({ ...prev, [fight.id]: { ...prev[fight.id], minute: '', second: '0' } }))} className="text-gray-500 hover:text-gray-300 text-sm">← Back</button>
                                <p className="text-xs text-gray-500 uppercase tracking-wider">Round {stop.round}, Minute {stop.minute} — slide to pick second</p>
                              </div>
                              <div className="text-center mb-4">
                                <p className="text-5xl font-black text-yellow-400 tabular-nums">
                                  {stop.minute}:{String(curSecond).padStart(2, '0')}
                                </p>
                                <p className="text-gray-500 text-sm mt-1">Round {stop.round}</p>
                              </div>
                              <input
                                type="range" min={0} max={59} value={curSecond}
                                onChange={(e) => setStopActual((prev) => ({ ...prev, [fight.id]: { ...prev[fight.id], second: e.target.value } }))}
                                className="w-full accent-yellow-500 mb-2"
                              />
                              <div className="flex justify-between text-xs text-gray-600 mb-2">
                                <span>:00</span><span>:15</span><span>:30</span><span>:45</span><span>:59</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Save */}
                      <button
                        onClick={() => saveFullResult(fight)}
                        disabled={savingResults[fight.id] || !form.winner || !form.method}
                        className="w-full bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-black py-3.5 rounded-xl text-sm transition-colors"
                      >
                        {savingResults[fight.id] ? 'Saving…' : 'Save & Score'}
                      </button>
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      </section>}

      {/* ── Players Tab ───────────────────────────────────────────────────── */}
      {activeTab === 'players' && (
        <section className="mb-10">
          <SectionHeader>Manage Players</SectionHeader>
          {players.length === 0 ? (
            <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-600">No players yet.</div>
          ) : (
            <div className="space-y-2">
              {players.map((player) => {
                const isExpanded = expandedPlayerId === player.id
                const playerPicks = allPicks.filter((p) => p.player_id === player.id)
                const playerBets = stoppageBets.filter((b) => b.player_id === player.id)
                const comp = competitions.find((c) => c.id === player.competition_id)
                return (
                  <div key={player.id} className="bg-gray-900 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedPlayerId(isExpanded ? null : player.id)}
                      className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-white font-bold">{player.name}</span>
                        {comp && <span className="text-xs text-gray-500">{comp.name}</span>}
                        {!player.activated && <span className="text-xs bg-orange-900/40 text-orange-400 px-2 py-0.5 rounded-full">Unpaid</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>{playerPicks.length}/{fights.length} picks</span>
                        {playerBets.length > 0 && <span className="text-yellow-600">jackpot</span>}
                        <span className="text-gray-600">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-800 px-5 py-4 space-y-5">
                        {/* Pick'em picks */}
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Pick&apos;em Picks</p>
                          <div className="space-y-2">
                            {fights.map((fight) => {
                              const edit = getPickEdit(player.id, fight.id)
                              const key = `${player.id}-${fight.id}`
                              return (
                                <div key={fight.id} className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs text-gray-500 w-14 shrink-0">Fight {fight.fight_number}</span>
                                  <select
                                    value={edit.winner}
                                    onChange={(e) => setPickEditField(player.id, fight.id, 'winner', e.target.value)}
                                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs"
                                  >
                                    <option value="">— no pick —</option>
                                    <option value={fight.fighter_a}>{fight.fighter_a}</option>
                                    <option value={fight.fighter_b}>{fight.fighter_b}</option>
                                  </select>
                                  <select
                                    value={edit.method}
                                    onChange={(e) => setPickEditField(player.id, fight.id, 'method', e.target.value)}
                                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs"
                                  >
                                    <option value="">— method —</option>
                                    <option value="KO/TKO">KO/TKO</option>
                                    <option value="Submission">Sub</option>
                                    <option value="Decision">Dec</option>
                                  </select>
                                  {edit.method && edit.method !== 'Decision' && (
                                    <input
                                      type="number" min={1} max={fight.rounds}
                                      value={edit.round}
                                      onChange={(e) => setPickEditField(player.id, fight.id, 'round', e.target.value)}
                                      placeholder="Rd"
                                      className="w-12 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs"
                                    />
                                  )}
                                  <button
                                    onClick={() => savePickEdit(player.id, fight.id, edit)}
                                    disabled={!edit.winner || !edit.method || savingPickId === key}
                                    className="bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-3 py-1 rounded text-xs font-semibold transition-colors"
                                  >
                                    {savingPickId === key ? '…' : 'Save'}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        </div>

                        {/* Jackpot bet */}
                        {playerBets.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Jackpot Bet</p>
                            <div className="space-y-2">
                              {playerBets.map((bet) => {
                                const fightForBet = fights.find((f) => f.id === bet.fight_id)
                                const edit = getBetEdit(bet)
                                return (
                                  <div key={bet.id} className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-gray-500 w-14 shrink-0">Fight {fightForBet?.fight_number}</span>
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-gray-600">R</span>
                                      <input type="number" min={1} max={fightForBet?.rounds ?? 5} value={edit.round} onChange={(e) => setBetEdits((prev) => ({ ...prev, [bet.id]: { ...getBetEdit(bet), round: e.target.value } }))} className="w-10 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs" />
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-gray-600">min</span>
                                      <input type="number" min={0} max={4} value={edit.minute} onChange={(e) => setBetEdits((prev) => ({ ...prev, [bet.id]: { ...getBetEdit(bet), minute: e.target.value } }))} className="w-10 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs" />
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-gray-600">sec</span>
                                      <input type="number" min={0} max={59} value={edit.second} onChange={(e) => setBetEdits((prev) => ({ ...prev, [bet.id]: { ...getBetEdit(bet), second: e.target.value } }))} className="w-10 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs" />
                                    </div>
                                    <button
                                      onClick={() => saveBetEdit(bet.id, edit)}
                                      disabled={savingBetId === bet.id}
                                      className="bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-700 text-white px-3 py-1 rounded text-xs font-semibold transition-colors"
                                    >
                                      {savingBetId === bet.id ? '…' : 'Save'}
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Danger actions */}
                        <div className="pt-3 border-t border-gray-800 flex flex-wrap gap-2">
                          <button
                            onClick={() => clearPlayerData(player.id, 'picks')}
                            disabled={clearingPlayer === `${player.id}-picks`}
                            className="bg-red-900/30 hover:bg-red-900/60 border border-red-800/40 text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                          >
                            {clearingPlayer === `${player.id}-picks` ? 'Clearing…' : 'Clear All Picks'}
                          </button>
                          {playerBets.length > 0 && (
                            <button
                              onClick={() => clearPlayerData(player.id, 'bet')}
                              disabled={clearingPlayer === `${player.id}-bet`}
                              className="bg-red-900/30 hover:bg-red-900/60 border border-red-800/40 text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                            >
                              {clearingPlayer === `${player.id}-bet` ? 'Clearing…' : 'Clear Jackpot Bet'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* ── SECTION 3: Payments Due ───────────────────────────────────────── */}
      {(() => {
        if (activeTab !== 'money') return null
        const pendingPickEm = players
          .filter((p) => !p.activated)
          .map((p) => {
            const comp = competitions.find((c) => c.id === p.competition_id)
            return {
              key: `pe-${p.id}`,
              name: p.name,
              desc: comp ? comp.name : "Pick'em",
              amount: comp ? comp.entry_fee : '—',
              createdAt: p.created_at,
              onActivate: () => activatePlayer(p.id, true),
            }
          })

        const pendingJackpots = stoppageBets
          .filter((b) => !b.activated)
          .map((b) => {
            const player = players.find((p) => p.id === b.player_id)
            const fight = fights.find((f) => f.id === b.fight_id)
            const m = b.minute_pick - 1
            const s = String(b.second_pick).padStart(2, '0')
            return {
              key: `jb-${b.id}`,
              name: player?.name ?? 'Unknown',
              desc: fight ? `Fight ${fight.fight_number} Jackpot — R${b.round_pick} ${m}:${s}` : 'Jackpot Bet',
              amount: `$${fight?.stoppage_bet_fee ?? '20'}`,
              createdAt: b.created_at,
              onActivate: () => activateStoppageBet(b.id, true),
            }
          })

        const allPending = [...pendingPickEm, ...pendingJackpots].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )

        return (
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <SectionHeader>Payments Due</SectionHeader>
              {allPending.length > 0 && (
                <span className="text-sm font-bold text-orange-400 bg-orange-900/30 px-3 py-1 rounded-full">
                  {allPending.length} pending
                </span>
              )}
            </div>
            <div className="bg-gray-900 rounded-xl overflow-x-auto">
              {allPending.length === 0 ? (
                <div className="px-4 py-10 text-center text-gray-600">All payments collected</div>
              ) : (
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Name', 'Owes', 'Amount', 'Activate'].map((h) => (
                        <th key={h} className="text-left text-xs text-gray-500 uppercase tracking-wider px-4 py-3 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allPending.map((item) => (
                      <tr key={item.key} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-4 py-3 text-white font-semibold">{item.name}</td>
                        <td className="px-4 py-3 text-gray-400 text-sm">{item.desc}</td>
                        <td className="px-4 py-3 text-green-400 font-bold">{item.amount}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={item.onActivate}
                            className="bg-green-700 hover:bg-green-600 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition-colors"
                          >
                            Activate
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        )
      })()}

      {/* ── SECTION 5: Payouts ────────────────────────────────────────────── */}
      {(() => {
        if (activeTab !== 'money') return null
        // Pick'em prizes — compute standings per competition
        const pickEmPayouts: Array<{ playerId: string; playerName: string; label: string; amount: number; paid: boolean }> = []
        if (fights.some((f) => f.status === 'complete')) {
          for (const comp of competitions) {
            if (!(comp.prize_splits ?? []).length) continue
            const poolData = expenseRecovery.poolData.find((d) => d.comp.id === comp.id)
            if (!poolData || poolData.actualPrizePool <= 0) continue
            const compPlayers = players.filter((p) => p.competition_id === comp.id && p.activated)
            if (compPlayers.length === 0) continue
            const ranked = compPlayers
              .map((p) => ({ player: p, total: scores.filter((s) => s.player_id === p.id).reduce((sum, s) => sum + s.fight_total, 0) }))
              .sort((a, b) => b.total - a.total)
            for (const split of comp.prize_splits ?? []) {
              const entry = ranked[split.place - 1]
              if (!entry) continue
              pickEmPayouts.push({
                playerId: entry.player.id,
                playerName: entry.player.name,
                label: `${comp.name} — ${ordinal(split.place)} Place`,
                amount: Math.round(poolData.actualPrizePool * split.pct / 100),
                paid: !!(entry.player.payout_paid),
              })
            }
          }
        }

        // Jackpot winners — find winner for each resolved fight
        const jackpotPayouts: Array<{ betId: string; playerName: string; label: string; amount: number; paid: boolean }> = []
        for (const fight of fights) {
          if (fight.stoppage_actual_round == null) continue
          const fightBets = stoppageBets.filter((b) => b.fight_id === fight.id && b.activated)
          if (fightBets.length === 0) continue
          const actualSec = (fight.stoppage_actual_round - 1) * 300 + (fight.stoppage_actual_minute ?? 0) * 60 + (fight.stoppage_actual_second ?? 0)
          const winnerBet = fightBets
            .filter((b) => (b.round_pick - 1) * 300 + (b.minute_pick - 1) * 60 + b.second_pick <= actualSec)
            .sort((a, b) => {
              const as = (a.round_pick - 1) * 300 + (a.minute_pick - 1) * 60 + a.second_pick
              const bs = (b.round_pick - 1) * 300 + (b.minute_pick - 1) * 60 + b.second_pick
              return bs - as
            })[0]
          if (!winnerBet) continue
          const fee = parseFloat(fight.stoppage_bet_fee ?? '20') || 20
          const m = winnerBet.minute_pick - 1
          const s = String(winnerBet.second_pick).padStart(2, '0')
          jackpotPayouts.push({
            betId: winnerBet.id,
            playerName: players.find((p) => p.id === winnerBet.player_id)?.name ?? 'Unknown',
            label: `Fight ${fight.fight_number} Jackpot — R${winnerBet.round_pick} ${m}:${s}`,
            amount: fightBets.length * fee + (fight.jackpot_rollover ?? 0),
            paid: !!(winnerBet.jackpot_paid),
          })
        }

        if (pickEmPayouts.length === 0 && jackpotPayouts.length === 0) return null

        // Aggregate payouts by player
        type PlayerTotalEntry = { playerName: string; items: Array<{ label: string; amount: number; color: string }>; total: number; allPaid: boolean; unpaidPickEmId: string | null; unpaidBetIds: string[] }
        const playerTotalsMap = new Map<string, PlayerTotalEntry>()
        for (const p of pickEmPayouts) {
          if (!playerTotalsMap.has(p.playerName)) playerTotalsMap.set(p.playerName, { playerName: p.playerName, items: [], total: 0, allPaid: true, unpaidPickEmId: null, unpaidBetIds: [] })
          const e = playerTotalsMap.get(p.playerName)!
          const placeLabel = p.label.split('—')[1]?.trim() ?? p.label
          e.items.push({ label: placeLabel, amount: p.amount, color: 'text-green-400' })
          e.total += p.amount
          if (!p.paid) { e.allPaid = false; e.unpaidPickEmId = p.playerId }
        }
        for (const p of jackpotPayouts) {
          if (!playerTotalsMap.has(p.playerName)) playerTotalsMap.set(p.playerName, { playerName: p.playerName, items: [], total: 0, allPaid: true, unpaidPickEmId: null, unpaidBetIds: [] })
          const e = playerTotalsMap.get(p.playerName)!
          const fightLabel = p.label.split('—')[0]?.trim() ?? p.label
          e.items.push({ label: fightLabel, amount: p.amount, color: 'text-yellow-400' })
          e.total += p.amount
          if (!p.paid) { e.allPaid = false; e.unpaidBetIds.push(p.betId) }
        }
        const sortedPlayerTotals = Array.from(playerTotalsMap.values()).sort((a, b) => b.total - a.total)

        const unpaidPickEm = pickEmPayouts.filter((p) => !p.paid)
        const unpaidJackpot = jackpotPayouts.filter((p) => !p.paid)
        const totalOwed = [...unpaidPickEm, ...unpaidJackpot].reduce((s, p) => s + p.amount, 0)
        const allPaid = unpaidPickEm.length === 0 && unpaidJackpot.length === 0

        return (
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <SectionHeader>Payouts</SectionHeader>
              {!allPaid && (
                <div className="flex items-center gap-3">
                  <span className="text-green-400 font-black text-xl">${totalOwed} owed</span>
                  <button
                    onClick={() => payAllPayouts(unpaidPickEm.map((p) => p.playerId), unpaidJackpot.map((p) => p.betId))}
                    disabled={payingAll}
                    className="bg-green-700 hover:bg-green-600 disabled:bg-gray-700 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors"
                  >
                    {payingAll ? 'Paying…' : `Pay $${totalOwed} total`}
                  </button>
                </div>
              )}
              {allPaid && <span className="text-gray-600 text-sm font-semibold">All paid ✓</span>}
            </div>

            {/* Player totals summary */}
            {sortedPlayerTotals.length > 0 && (
              <div className="bg-gray-900 rounded-xl overflow-hidden mb-4">
                <div className="px-5 py-3 border-b border-gray-800">
                  <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Winner Totals</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {sortedPlayerTotals.map((entry) => (
                      <tr key={entry.playerName} className={`border-b border-gray-800/50 ${!entry.allPaid ? 'bg-gray-800/10' : ''}`}>
                        <td className="px-5 py-3.5 text-white font-bold w-32 shrink-0">{entry.playerName}</td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap gap-2">
                            {entry.items.map((item, i) => (
                              <span key={i} className="flex items-center gap-1">
                                <span className="text-gray-500 text-xs">{item.label}</span>
                                <span className={`font-bold text-sm ${item.color}`}>${item.amount}</span>
                                {i < entry.items.length - 1 && <span className="text-gray-700 ml-1">+</span>}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <span className="text-white font-black text-lg mr-3">${entry.total}</span>
                          {entry.allPaid
                            ? <span className="text-xs font-semibold text-gray-600 bg-gray-800 px-3 py-1.5 rounded-lg">Paid</span>
                            : <button
                                onClick={() => markPlayerAllPaid(entry.playerName, entry.unpaidPickEmId, entry.unpaidBetIds)}
                                disabled={payingPlayer === entry.playerName}
                                className="bg-green-700 hover:bg-green-600 disabled:bg-gray-700 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition-colors"
                              >
                                {payingPlayer === entry.playerName ? 'Paying…' : `Pay $${entry.total}`}
                              </button>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="space-y-4">
              {pickEmPayouts.length > 0 && (
                <div className="bg-gray-900 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-800">
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Pick&apos;em Prizes</span>
                  </div>
                  <table className="w-full text-sm whitespace-nowrap">
                    <tbody>
                      {pickEmPayouts.map((payout) => (
                        <tr key={`${payout.playerId}-${payout.label}`} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="px-4 py-3 text-white font-semibold">{payout.playerName}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{payout.label}</td>
                          <td className="px-4 py-3 text-green-400 font-black text-base">${payout.amount}</td>
                          <td className="px-4 py-3 text-right">
                            {payout.paid
                              ? <span className="text-xs font-semibold text-gray-600 bg-gray-800 px-3 py-1.5 rounded-lg">Paid</span>
                              : <button onClick={() => markPickEmPaid(payout.playerId)} className="bg-blue-700 hover:bg-blue-600 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition-colors">Mark Paid</button>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {jackpotPayouts.length > 0 && (
                <div className="bg-gray-900 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-800">
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Jackpot Winners</span>
                  </div>
                  <table className="w-full text-sm whitespace-nowrap">
                    <tbody>
                      {jackpotPayouts.map((payout) => (
                        <tr key={payout.betId} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="px-4 py-3 text-white font-semibold">{payout.playerName}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{payout.label}</td>
                          <td className="px-4 py-3 text-yellow-400 font-black text-base">${payout.amount}</td>
                          <td className="px-4 py-3 text-right">
                            {payout.paid
                              ? <span className="text-xs font-semibold text-gray-600 bg-gray-800 px-3 py-1.5 rounded-lg">Paid</span>
                              : <button onClick={() => markJackpotPaid(payout.betId)} className="bg-blue-700 hover:bg-blue-600 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition-colors">Mark Paid</button>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )
      })()}

      {/* ── Danger Zone ───────────────────────────────────────────────────── */}
      {activeTab === 'setup' && <section>
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
      </section>}
    </div>
  )
}
