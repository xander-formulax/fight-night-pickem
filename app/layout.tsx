import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: "UFC Fight Night Pick'em",
  description: 'Make your picks for Fight Night',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        {/* Fight poster ambient background */}
        <div
          className="fixed inset-0 -z-10 pointer-events-none"
          style={{
            backgroundImage: "url('/poster.webp')",
            backgroundSize: 'cover',
            backgroundPosition: 'center 20%',
            backgroundRepeat: 'no-repeat',
            opacity: 0.07,
            filter: 'blur(6px) saturate(1.4)',
          }}
        />
        {children}
      </body>
    </html>
  )
}
