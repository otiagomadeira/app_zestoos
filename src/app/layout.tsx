import type { Metadata, Viewport } from 'next'
import { Playfair_Display, Montserrat, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const playfair = Playfair_Display({
  subsets:  ['latin'],
  variable: '--font-playfair',
  display:  'swap',
})

const montserrat = Montserrat({
  subsets:  ['latin'],
  variable: '--font-montserrat',
  display:  'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets:  ['latin'],
  variable: '--font-mono',
  display:  'swap',
})

export const metadata: Metadata = {
  title:       'Zesto OS — The Silent Engine',
  description: 'Kitchen operating system for professional kitchens',
  manifest:    '/manifest.json',
}

export const viewport: Viewport = {
  width:              'device-width',
  initialScale:       1,
  maximumScale:       1,
  themeColor:         '#1F3A2E',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" style={{ height: '100%' }} className={`${playfair.variable} ${montserrat.variable} ${jetbrainsMono.variable}`}>
      <body style={{ height: '100%', background: '#F2E9DC' }}>
        {children}
      </body>
    </html>
  )
}
