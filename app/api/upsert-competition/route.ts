import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { PrizeSplit } from '@/lib/types'

export async function POST(request: NextRequest) {
  const { id, name, entry_fee, description, house_cut_pct, prize_splits } = await request.json()

  if (!name?.trim() || !entry_fee?.trim()) {
    return NextResponse.json({ error: 'Name and entry fee are required' }, { status: 400 })
  }

  const splits: PrizeSplit[] = Array.isArray(prize_splits) ? prize_splits : []
  if (splits.length > 0) {
    const total = splits.reduce((sum, s) => sum + (s.pct ?? 0), 0)
    if (Math.abs(total - 100) > 0.01) {
      return NextResponse.json({ error: `Prize splits must total 100% (currently ${total.toFixed(1)}%)` }, { status: 400 })
    }
  }

  const payload = {
    name: name.trim(),
    entry_fee: entry_fee.trim(),
    description: description?.trim() || null,
    house_cut_pct: Math.max(0, Math.min(100, parseInt(house_cut_pct ?? '0', 10) || 0)),
    prize_splits: splits,
  }

  const supabase = getSupabaseAdmin()

  if (id) {
    const { error } = await supabase.from('competitions').update(payload).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase.from('competitions').insert(payload)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
