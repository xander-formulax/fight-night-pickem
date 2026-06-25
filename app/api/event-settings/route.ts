import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getStorageConfig, setStorageConfig } from '@/lib/storage-config'

export async function GET() {
  const supabase = getSupabaseAdmin()
  const [{ data }, config] = await Promise.all([
    supabase.from('event_settings').select('party_cost_target').eq('id', 1).single(),
    getStorageConfig(supabase),
  ])
  return NextResponse.json({
    party_cost_target: data?.party_cost_target ?? 0,
    event_title: config.event_title ?? '',
    poster_url: config.poster_url ?? '',
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const supabase = getSupabaseAdmin()
  if ('party_cost_target' in body) {
    await supabase.from('event_settings').upsert({ id: 1, party_cost_target: Math.max(0, parseFloat(body.party_cost_target) || 0) })
  }

  const storageUpdates: Record<string, string> = {}
  if ('event_title' in body) storageUpdates.event_title = body.event_title ?? ''
  if ('poster_url' in body) storageUpdates.poster_url = body.poster_url ?? ''
  if (Object.keys(storageUpdates).length > 0) await setStorageConfig(supabase, storageUpdates)
  return NextResponse.json({ success: true })
}
