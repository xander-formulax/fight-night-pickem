import { SupabaseClient } from '@supabase/supabase-js'

export async function getStorageConfig(supabase: SupabaseClient): Promise<Record<string, string>> {
  try {
    const { data, error } = await supabase.storage.from('settings').download('app-config.json')
    if (data && !error) return JSON.parse(await data.text())
  } catch {}
  return {}
}

export async function setStorageConfig(supabase: SupabaseClient, updates: Record<string, string>): Promise<void> {
  const current = await getStorageConfig(supabase)
  const next = { ...current, ...updates }
  await supabase.storage.createBucket('settings', { public: false }).catch(() => {})
  const content = Buffer.from(JSON.stringify(next))
  const { error } = await supabase.storage.from('settings').upload('app-config.json', content, {
    contentType: 'application/json',
    upsert: true,
  })
  if (error) throw new Error(`Config save failed: ${error.message}`)
}
