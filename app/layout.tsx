import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Shopping — Find the best deal',
  description: 'AI-first product search and deal discovery MVP.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
