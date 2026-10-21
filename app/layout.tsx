import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from './components/AuthContext';

export const metadata: Metadata = {
  title: 'Smart Sugar AI',
  description: 'AI-powered sugar market intelligence dashboard',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Sugar AI' },
};
export const viewport: Viewport = { themeColor: '#2563eb', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
