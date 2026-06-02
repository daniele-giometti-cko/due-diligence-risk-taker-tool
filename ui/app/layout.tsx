import type { Metadata } from 'next';
import { requireAuth } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'DD Risk-Taker Tool',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();

  return (
    <html lang="en">
      <body style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        {session && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
            gap: '1rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#555',
          }}>
            <span>{session.user.email ?? session.user.name ?? session.user.sub}</span>
            <a href="/api/auth/logout" style={{ color: '#c0392b', textDecoration: 'none' }}>Sign out</a>
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
