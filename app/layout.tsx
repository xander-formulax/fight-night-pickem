import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { PosterBackground } from '@/app/components/PosterBackground'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: "UFC Fight Night Pick'em",
  description: 'Make your picks for Fight Night',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        <PosterBackground />
        <div className="relative min-h-screen bg-black/55 backdrop-blur-sm">
          {children}
        </div>
      </body>
    </html>
  )
}
