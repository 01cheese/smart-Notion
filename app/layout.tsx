import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'void',
  description: 'minimal notepad',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
      <html lang="en">
      {/* suppressHydrationWarning prevents noise from browser extensions
          like ColorZilla that inject attributes into <body> */}
      <body suppressHydrationWarning>{children}</body>
      </html>
  )
}