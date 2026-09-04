import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footergrid">
        <div>
          <div className="wordmark footbrand">CENIQ<span>.</span></div>
          <p>Produktu un veikalu cenu salīdzināšana vienā katalogā.</p>
          <small>Dažas izejošās saites var būt affiliate saites. Cena pircējam no tā nemainās.</small>
        </div>
        <div><strong>CENIQ</strong><Link href="/#ka-darbojas">Kā tas strādā</Link><Link href="/#kategorijas">Kategorijas</Link><Link href="mailto:hello@ceniq.lv">Kontakti</Link></div>
        <div><strong>Lietotājam</strong><Link href="/account">Mana izlase</Link><Link href="/account">Cenu brīdinājumi</Link><Link href="/#meklet">CENIQ AI</Link></div>
        <div><strong>Juridiskais</strong><Link href="/privacy">Privātuma politika</Link><Link href="/terms">Lietošanas noteikumi</Link><Link href="/affiliate">Affiliate info</Link></div>
      </div>
      <div className="container footbottom"><span>© {new Date().getFullYear()} CENIQ</span><a href="#top">Atpakaļ augšā ↑</a></div>
    </footer>
  );
}
