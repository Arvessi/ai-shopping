'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import ProductCard from './ProductCard';
import type { AiShoppingPlan, ProductResult } from '@/lib/types';

const categories = [
  ['📱', 'Telefoni', 'smartphone'], ['💻', 'Portatīvie', 'laptop'], ['🖥️', 'Monitori', 'gaming monitor'], ['📺', 'TV', 'OLED TV'],
  ['🎧', 'Audio', 'wireless headphones'], ['🎮', 'Gaming', 'gaming accessories'], ['📷', 'Kameras', 'mirrorless camera'], ['🏠', 'Mājai', 'smart home electronics']
];

const fallbackPopular = ['iPhone 17 Pro', 'gaming monitors 240Hz', 'OLED TV 55', 'MacBook Air', 'wireless headphones'];

export default function SearchExperience() {
  const [mode, setMode] = useState<'search' | 'assistant'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductResult[]>([]);
  const [popular, setPopular] = useState<string[]>(fallbackPopular);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<AiShoppingPlan | null>(null);

  useEffect(() => { fetch('/api/popular').then((r) => r.json()).then((d) => d.searches?.length && setPopular(d.searches)).catch(() => undefined); }, []);

  async function runDataSearch(searchQuery: string, searchMode: 'search' | 'assistant') {
    setStatus('Meklējam veikalos…');
    const start = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: searchQuery, mode: searchMode }) });
    const startData = await start.json();
    if (!start.ok) throw new Error(startData.error || 'Meklēšanu neizdevās sākt.');
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((r) => setTimeout(r, 1200));
      const poll = await fetch(`/api/search?taskId=${encodeURIComponent(startData.taskId)}`, { cache: 'no-store' });
      const data = await poll.json();
      if (!poll.ok) throw new Error(data.error || 'Meklēšana neizdevās.');
      if (data.pending) { setStatus(attempt < 3 ? 'Savācam cenas…' : 'Salīdzinām piedāvājumus…'); continue; }
      setResults(Array.isArray(data.results) ? data.results : []);
      setStatus('');
      return;
    }
    throw new Error('Meklēšana aizņēma pārāk ilgu laiku. Pamēģini vēlreiz.');
  }

  async function submit(e?: FormEvent, override?: string) {
    e?.preventDefault();
    const input = (override ?? query).trim();
    if (!input || loading) return;
    if (override) setQuery(override);
    setLoading(true); setError(''); setResults([]); setPlan(null);
    try {
      if (mode === 'assistant') {
        setStatus('Ceniq AI saprot tavas prasības…');
        const ai = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: input }) });
        const aiData = await ai.json();
        if (!ai.ok) throw new Error(aiData.error || 'Ceniq AI neizdevās.');
        setPlan(aiData.plan);
        await runDataSearch(aiData.plan.searchQuery, 'assistant');
      } else await runDataSearch(input, 'search');
    } catch (err) { setError(err instanceof Error ? err.message : 'Radās kļūda.'); setStatus(''); }
    finally { setLoading(false); }
  }

  return (
    <>
      <section className="hero" id="meklet">
        <div className="eyebrow">Latvijas cenu meklētājs + AI</div>
        <h1>Atrodi labāko cenu.<br/><span>Pērc gudrāk.</span></h1>
        <p>Ceniq salīdzina produktus, veikalu piedāvājumus un piegādi vienuviet.</p>
        <div className="modes">
          <button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>⌕ Parastā meklēšana</button>
          <button className={mode === 'assistant' ? 'active' : ''} onClick={() => setMode('assistant')}>✦ Ceniq AI</button>
        </div>
        <form className="bigsearch" onSubmit={(e: FormEvent<HTMLFormElement>) => submit(e)}>
          <span>{mode === 'search' ? '⌕' : '✦'}</span>
          <input value={query} onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} placeholder={mode === 'search' ? 'Piem., iPhone 17 Pro 256GB' : 'Piem., gaming monitors līdz 300 €, vismaz 144Hz un 27 collas'} />
          <button disabled={loading}>{loading ? 'Meklē…' : mode === 'search' ? 'Meklēt' : 'Jautāt AI'}</button>
        </form>
        {status && <div className="searchstatus"><i></i>{status}</div>}
        {error && <div className="errorbox">{error}</div>}
      </section>

      {plan && <section className="container aianswer"><div className="aibadge">✦ Ceniq AI</div><h2>{plan.summary}</h2><div className="chips">{plan.constraints.map((x: string) => <span key={x}>{x}</span>)}</div></section>}

      {results.length > 0 && <section className="container results"><div className="sectiontitle"><div><span>ATRASTIE PRODUKTI</span><h2>Labākās izvēles</h2></div><p>{results.length} sagrupēti produkti</p></div><div className="productgrid">{results.map((p: ProductResult) => <ProductCard product={p} key={p.id} />)}</div></section>}

      <section className="container section" id="populari">
        <div className="sectiontitle"><div><span>ŠOBRĪD MEKLĒ</span><h2>Populārākie meklējumi</h2></div></div>
        <div className="popularRow">{popular.map((item: string, i: number) => <button key={item} onClick={() => submit(undefined, item)}><b>{String(i + 1).padStart(2, '0')}</b><span>{item}</span><i>↗</i></button>)}</div>
      </section>

      <section className="container section">
        <div className="sectiontitle"><div><span>ĀTRĀ PIEKĻUVE</span><h2>Kategorijas</h2></div></div>
        <div className="categorygrid">{categories.map(([icon, label, q]) => <button key={label} onClick={() => { setMode('search'); submit(undefined, q); }}><span>{icon}</span><b>{label}</b><i>→</i></button>)}</div>
      </section>

      <section className="container how" id="ka-darbojas">
        <div className="howintro"><span>KĀ DARBOJAS CENIQ?</span><h2>No vajadzības līdz labākajam piedāvājumam.</h2><p>Tu izvēlies — precīzs produkts vai saruna ar AI. Ceniq izdara salīdzināšanu.</p></div>
        <div className="howgrid"><article><b>01</b><h3>Meklē produktu</h3><p>Ieraksti modeli, ko jau zini. Ceniq grupē viena produkta piedāvājumus no dažādiem veikaliem.</p></article><article><b>02</b><h3>Vai apraksti vajadzību</h3><p>Ceniq AI pārvērš tavas prasības konkrētos parametros un atrod atbilstošākos produktus.</p></article><article><b>03</b><h3>Izvēlies gudrāk</h3><p>Cena, piegāde un tirgotāja signāli tiek apvienoti Ceniq vērtējumā, lai lētākais nebūtu vienīgais kritērijs.</p></article></div>
      </section>
    </>
  );
}
