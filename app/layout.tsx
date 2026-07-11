import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { PosterBackground } from '@/app/components/PosterBackground'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: "UFC Fight Night Pick'em",
  description: 'Make your picks for Fight Night',
}

// viewportFit: 'cover' lets env(safe-area-inset-*) report real values on
// notched phones, so bottom sheets and sticky nav bars clear the home indicator.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        <PosterBackground />
        {/* NOTE: no backdrop-blur here — a backdrop-filter on this wrapper would
            become the containing block for every fixed child (bottom sheets, modals,
            sticky navs), pinning them to the document instead of the viewport.
            The blur lives on the poster layer itself instead. */}
        <div className="relative min-h-screen bg-black/55">
          {children}
        </div>
      </body>
    </html>
  )
}
