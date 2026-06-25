'use client'
import { useEffect, useState } from 'react'

export function PosterBackground() {
  const [url, setUrl] = useState('')

  useEffect(() => {
    fetch('/api/event-settings')
      .then((r) => r.json())
      .then((d) => { if (d.poster_url) setUrl(d.poster_url) })
      .catch(() => {})
  }, [])

  if (!url) return null
  return (
    <div
      className="fixed inset-0 -z-10 pointer-events-none"
      style={{
        backgroundImage: `url('${url}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        backgroundRepeat: 'no-repeat',
        filter: 'brightness(1.05) saturate(1.3)',
      }}
    />
  )
}
