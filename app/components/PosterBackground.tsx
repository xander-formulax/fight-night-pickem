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
      className="fixed -z-10 pointer-events-none"
      style={{
        // Oversized by the blur radius so blurred edges don't show a halo
        inset: '-12px',
        backgroundImage: `url('${url}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        backgroundRepeat: 'no-repeat',
        // Blur lives here (self-contained) rather than as a backdrop-filter on the
        // content wrapper, which would break fixed positioning for all children.
        filter: 'brightness(1.05) saturate(1.3) blur(4px)',
      }}
    />
  )
}
