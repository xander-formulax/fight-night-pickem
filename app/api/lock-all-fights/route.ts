import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST() {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('fights')
    .update({ status: 'locked' })
    .eq('status', 'upcoming')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
