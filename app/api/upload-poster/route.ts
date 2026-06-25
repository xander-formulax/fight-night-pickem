import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { setStorageConfig } from '@/lib/storage-config'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  await supabase.storage.createBucket('assets', { public: true }).catch(() => {})

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'

  const { error } = await supabase.storage.from('assets').upload(`poster.${ext}`, buffer, {
    contentType: file.type,
    upsert: true,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(`poster.${ext}`)

  await setStorageConfig(supabase, { poster_url: publicUrl })

  return NextResponse.json({ url: publicUrl })
}
