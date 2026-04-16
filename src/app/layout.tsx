import type { Metadata, Viewport } from 'next'
import './globals.css'
import AppShell from '@/components/AppShell'

export const metadata: Metadata = {
  title:       'Zesto OS — The Silent Engine',
  description: 'Kitchen operating system for professional kitchens',
  manifest:    '/manifest.json',
}

export const viewport: Viewport = {
  width:              'device-width',
  initialScale:       1,
  maximumScale:       1,
  themeColor:         '#0A0A0A',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" style={{ height: '100%' }}>
      <body style={{ height: '100%', background: '#0A0A0A' }}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
