import type { Metadata } from 'next';
import './globals.css';
import './ceniq80.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://ceniq.lv'),
  title: { default: 'CENIQ — atrodi un salīdzini cenas', template: '%s | CENIQ' },
  description: 'CENIQ salīdzina aktuālus produktu un veikalu piedāvājumus vienā katalogā. Meklē pats vai izmanto CENIQ AI.',
  openGraph: { title: 'CENIQ', description: 'Atrodi produktu. Salīdzini īsto cenu.', type: 'website' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="lv" suppressHydrationWarning><body id="top"><Header/><main>{children}</main><Footer/></body></html>;
}
