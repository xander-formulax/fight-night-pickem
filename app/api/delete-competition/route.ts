import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { competition_id } = await request.json()
  if (!competition_id) return NextResponse.json({ error: 'Missing competition_id' }, { status: 400 })

  const supabase = getSupabaseAdmin()

  const { count } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('competition_id', competition_id)

  if (count && count > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} player(s) are registered in this pool.` },
      { status: 400 }
    )
  }

  const { error } = await supabase.from('competitions').delete().eq('id', competition_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
