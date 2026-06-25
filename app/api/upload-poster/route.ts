import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  await supabase.storage.createBucket('assets', { public: true }).catch(() => {})

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `poster.${ext}`

  const { error } = await supabase.storage.from('assets').upload(path, buffer, {
    contentType: file.type,
    upsert: true,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(path)

  await supabase.from('event_settings').upsert({ id: 1, poster_url: publicUrl })

  return NextResponse.json({ url: publicUrl })
}
