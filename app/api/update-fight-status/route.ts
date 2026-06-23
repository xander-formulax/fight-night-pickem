import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

const VALID_STATUSES = ['upcoming', 'locked', 'complete']

export async function POST(request: NextRequest) {
  const { fight_id, status } = await request.json()

  if (!fight_id || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('fights').update({ status }).eq('id', fight_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
