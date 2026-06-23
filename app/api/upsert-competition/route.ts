import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { id, name, entry_fee, description } = await request.json()

  if (!name?.trim() || !entry_fee?.trim()) {
    return NextResponse.json({ error: 'Name and entry fee are required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  if (id) {
    const { error } = await supabase
      .from('competitions')
      .update({ name: name.trim(), entry_fee: entry_fee.trim(), description: description?.trim() || null })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase
      .from('competitions')
      .insert({ name: name.trim(), entry_fee: entry_fee.trim(), description: description?.trim() || null })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
