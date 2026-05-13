import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Agentic - Logs Teller',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        {children}
      </body>
    </html>
  );
}
