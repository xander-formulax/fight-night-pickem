import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('event_settings')
    .select('party_cost_target')
    .eq('id', 1)
    .single()
  return NextResponse.json({ party_cost_target: data?.party_cost_target ?? 0 })
}

export async function POST(request: NextRequest) {
  const { party_cost_target } = await request.json()
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('event_settings')
    .upsert({ id: 1, party_cost_target: Math.max(0, parseFloat(party_cost_target) || 0) })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
