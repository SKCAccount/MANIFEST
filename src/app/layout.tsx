import type { Metadata, Viewport } from 'next';
import { Nav } from '@/components/nav';
import { QuickCaptureProvider } from '@/components/quick-capture';
import { currentOperator } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'MANIFEST', template: '%s · MANIFEST' },
  description: 'Sea King Capital — relationship system.',
  applicationName: 'MANIFEST',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'MANIFEST', statusBarStyle: 'default' },
  // Private by construction. Nothing here should ever be indexed.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfc' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1d21' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const operator = await currentOperator();

  return (
    <html lang="en">
      <body>
        {operator ? (
          <QuickCaptureProvider>
            <Nav operatorEmail={operator.email} />
            <div className="mx-auto w-full max-w-5xl px-4 pb-28 sm:px-6 sm:pb-16">{children}</div>
          </QuickCaptureProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
