import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST() {
  const supabase = getSupabaseAdmin()

  // Delete in FK-safe order
  await supabase.from('scores').delete().not('id', 'is', null)
  await supabase.from('picks').delete().not('id', 'is', null)
  await supabase.from('players').delete().not('id', 'is', null)
  await supabase.from('fights').delete().not('id', 'is', null)

  return NextResponse.json({ success: true })
}
