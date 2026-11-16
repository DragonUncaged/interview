import type { Metadata } from 'next';
import { Space_Grotesk, JetBrains_Mono, Caveat } from 'next/font/google';
import './globals.css';

const ui = Space_Grotesk({ variable: '--font-ui', subsets: ['latin'], weight: ['400', '500', '600', '700'] });
const mono = JetBrains_Mono({ variable: '--font-mono', subsets: ['latin'], weight: ['400', '500', '600', '700'] });
const hand = Caveat({ variable: '--font-hand', subsets: ['latin'], weight: ['500', '600', '700'] });

export const metadata: Metadata = {
  title: 'PARALLEL — Interview Studio',
  description: 'Run live coding interviews that feel like pairing.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${ui.variable} ${mono.variable} ${hand.variable}`}>{children}</body>
    </html>
  );
}
