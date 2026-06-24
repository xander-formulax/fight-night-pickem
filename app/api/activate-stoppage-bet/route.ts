import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { bet_id, value } = await request.json()

  if (!bet_id) {
    return NextResponse.json({ error: 'bet_id is required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('stoppage_bets')
    .update({ paid: value, activated: value })
    .eq('id', bet_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
