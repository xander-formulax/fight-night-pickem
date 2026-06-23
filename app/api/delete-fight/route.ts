import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const { fight_id } = await request.json()
  if (!fight_id) return NextResponse.json({ error: 'Missing fight_id' }, { status: 400 })

  const supabase = getSupabaseAdmin()

  // Delete picks first (FK constraint), then the fight (only if upcoming)
  await supabase.from('picks').delete().eq('fight_id', fight_id)
  const { error } = await supabase
    .from('fights')
    .delete()
    .eq('id', fight_id)
    .eq('status', 'upcoming')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
