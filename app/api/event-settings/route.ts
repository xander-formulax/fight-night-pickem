import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('event_settings')
    .select('party_cost_target, event_title, poster_url')
    .eq('id', 1)
    .single()
  return NextResponse.json({
    party_cost_target: data?.party_cost_target ?? 0,
    event_title: data?.event_title ?? '',
    poster_url: data?.poster_url ?? '',
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const supabase = getSupabaseAdmin()
  const update: Record<string, unknown> = { id: 1 }
  if ('party_cost_target' in body) update.party_cost_target = Math.max(0, parseFloat(body.party_cost_target) || 0)
  if ('event_title' in body) update.event_title = body.event_title ?? ''
  if ('poster_url' in body) update.poster_url = body.poster_url ?? ''
  const { error } = await supabase.from('event_settings').upsert(update)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
