import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footergrid">
        <div><div className="wordmark footbrand">ceniq<span>.</span></div><p>Atrodi labāko cenu. Pērc gudrāk.</p><small>Dažas saites var būt affiliate saites. Cena tev nemainās.</small></div>
        <div><strong>Ceniq</strong><Link href="/#ka-darbojas">Kā tas darbojas</Link><Link href="mailto:hello@ceniq.lv">Kontakti</Link></div>
        <div><strong>Lietotājam</strong><Link href="/account">Mana izlase</Link><Link href="/account">Cenu brīdinājumi</Link></div>
        <div><strong>Juridiskais</strong><Link href="/privacy">Privātuma politika</Link><Link href="/terms">Lietošanas noteikumi</Link><Link href="/affiliate">Affiliate info</Link></div>
      </div>
      <div className="container footbottom"><span>© {new Date().getFullYear()} Ceniq</span><a href="#top">Atpakaļ augšā ↑</a></div>
    </footer>
  );
}
