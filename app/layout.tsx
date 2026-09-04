import type { Metadata } from 'next';
import './globals.css';
import './ceniq21.css';
import './ceniq32.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://ceniq.lv'),
  title: { default: 'Ceniq — Atrodi labāko cenu', template: '%s | Ceniq' },
  description: 'Ceniq salīdzina produktu cenas un veikalu piedāvājumus. Meklē pats vai izmanto Ceniq AI.',
  openGraph: { title: 'Ceniq', description: 'Atrodi labāko cenu. Pērc gudrāk.', type: 'website' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="lv" suppressHydrationWarning><body id="top"><Header/><main>{children}</main><Footer/></body></html>;
}
