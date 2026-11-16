import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// Self-hosted because fetching from Google Fonts at build time fails at random under
// Turbopack. Latin-subset variable fonts under the SIL Open Font License (fonts/OFL.txt).
const spaceGrotesk = localFont({ src: './fonts/space-grotesk-latin.woff2', weight: '400 700', variable: '--font-ui' });
const jetbrainsMono = localFont({ src: './fonts/jetbrains-mono-latin.woff2', weight: '400 700', variable: '--font-mono' });
const caveat = localFont({ src: './fonts/caveat-latin.woff2', weight: '500 700', variable: '--font-hand' });

export const metadata: Metadata = {
  title: 'PARALLEL — Interview Studio',
  description: 'Run live coding interviews that feel like pairing.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} ${caveat.variable}`}>{children}</body>
    </html>
  );
}
