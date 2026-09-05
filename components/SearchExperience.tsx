'use client';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import ProductCard from './ProductCard';
import AiShortlist from './AiShortlist';
import type { ProductResult } from '@/lib/types';
import type { Recommendation, ShoppingIntent } from '@/lib/shopping-intent';
const categories = [
    ['Telefoni', 'smartphone', 'Ikdiena tavā plaukstā', '01'], ['Portatīvie datori', 'laptop', 'No pirmās idejas līdz pēdējam kadram', '02'],
    ['Monitori', 'monitor', 'Vairāk vietas domām', '03'], ['TV', 'TV', 'Lielajam vakaram', '04'], ['Audio', 'headphones', 'Ieklausies detaļās', '05'],
    ['Gaming', 'gaming', 'Tavam nākamajam līmenim', '06'], ['Kameras', 'camera', 'Saglabā savu skatpunktu', '07'], ['Māja', 'home appliance', 'Mazāk darba. Vairāk dzīves.', '08'],
    ['Sports', 'sports', 'Kustībai un brīvdienām', '09'], ['Velo', 'bike', 'Savam nākamajam maršrutam', '10'], ['Skaistums', 'beauty', 'Ikdienas rituāliem', '11'], ['Bērniem', 'toys', 'Mazajiem atklājējiem', '12'],
];
const examples = ['Samsung Galaxy S25', 'Sony WH-1000XM5', 'MacBook Air M3'];
const aiExamples = ['telefons līdz 600 € ar labu kameru', 'gaming laptop līdz 1200 € ar vismaz 16GB RAM', 'salīdzini iPhone 16 un Samsung Galaxy S25'];
const KEY = 'ceniq-discovery-state';
type Mode = 'search' | 'assistant';
export default function SearchExperience() {
    const [mode, setMode] = useState<Mode>('search'), [query, setQuery] = useState('');
    const [results, setResults] = useState<ProductResult[]>([]), [recommendations, setRecommendations] = useState<Recommendation[]>([]);
    const [plan, setPlan] = useState<ShoppingIntent | null>(null), [popular, setPopular] = useState<string[]>([]);
    const [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [searched, setSearched] = useState(false);
    const [brand, setBrand] = useState(''), [merchant, setMerchant] = useState(''), [ceiling, setCeiling] = useState(''), [sort, setSort] = useState('best');
    const [ready, setReady] = useState(false);
    useEffect(() => {
        fetch('/api/popular').then(r => r.json()).then(d => { if (Array.isArray(d.searches))
            setPopular([...new Map<string, string>(d.searches.filter((s: unknown): s is string => typeof s === 'string').map((s: string) => [s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''), s])).values()]); }).catch(() => undefined);
        try {
            const params = new URLSearchParams(location.search);
            if (params.has('q') || params.has('mode')) {
                setQuery(params.get('q') || '');
                setMode(params.get('mode') === 'assistant' ? 'assistant' : 'search');
            }
            else {
                const state = JSON.parse(sessionStorage.getItem(KEY) || 'null');
                if (state) {
                    setQuery(state.query || '');
                    setMode(state.mode === 'assistant' ? 'assistant' : 'search');
                    setResults(state.results || []);
                    setRecommendations(state.recommendations || []);
                    setPlan(state.plan || null);
                    setSearched(Boolean(state.searched));
                }
            }
        }
        catch { }
        finally {
            setReady(true);
        }
        const changeMode = () => { setMode('assistant'); document.getElementById('shopping-query')?.focus(); };
        window.addEventListener('ceniq-ai', changeMode);
        return () => window.removeEventListener('ceniq-ai', changeMode);
    }, []);
    useEffect(() => { if (ready)
        try {
            sessionStorage.setItem(KEY, JSON.stringify({ query, mode, results, recommendations, plan, searched }));
        }
        catch { } }, [ready, query, mode, results, recommendations, plan, searched]);
    const brands = useMemo(() => [...new Set(results.map(p => p.brand).filter((s): s is string => !!s))].sort(), [results]);
    const merchants = useMemo(() => [...new Set(results.flatMap(p => p.offers.map(o => o.merchant)))].sort(), [results]);
    const visible = useMemo(() => results.filter(p => (!brand || p.brand === brand) && (!merchant || p.offers.some(o => o.merchant === merchant)) && (!ceiling || p.bestPrice <= Number(ceiling))).sort((a, b) => sort === 'price' ? a.bestPrice - b.bestPrice : sort === 'stores' ? (b.storesCount || 0) - (a.storesCount || 0) : sort === 'score' ? b.dealScore - a.dealScore : 0), [results, brand, merchant, ceiling, sort]);
    function reset() { setBrand(''); setMerchant(''); setCeiling(''); setSort('best'); }
    async function search(event?: FormEvent, override?: string, forced?: Mode) {
        event?.preventDefault();
        const q = (override ?? query).trim(), m = forced ?? mode;
        if (!q || loading)
            return;
        setQuery(q);
        setMode(m);
        setLoading(true);
        setError('');
        setNotice('');
        setSearched(true);
        setResults([]);
        setRecommendations([]);
        setPlan(null);
        reset();
        try {
            const response = await fetch(m === 'assistant' ? '/api/ai' : '/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m === 'assistant' ? { prompt: q } : { q, mode: m }), signal: AbortSignal.timeout(30000) });
            const data = await response.json();
            if (data.plan)
                setPlan(data.plan);
            if (!response.ok)
                throw new Error(data.error || 'Meklēšana neizdevās.');
            if (m === 'assistant') {
                setRecommendations(data.recommendations || []);
                setNotice(data.missingTargets?.length ? `Katalogā neatradām: ${data.missingTargets.join(', ')}.` : data.message || '');
            }
            else {
                setResults(data.results || []);
                setNotice(data.message || '');
            }
            history.replaceState(history.state, '', '/');
            window.setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }), 80);
        }
        catch (e) {
            setError(e instanceof Error && e.name === 'TimeoutError' ? 'Meklēšana aizņēma pārāk ilgu laiku. Pamēģini vēlreiz.' : e instanceof Error ? e.message : 'Neizdevās ielādēt rezultātus.');
        }
        finally {
            setLoading(false);
        }
    }
    return <>
    <section className={`discovery-hero ${searched ? 'compact' : ''}`} id="meklet">
      <div className="container hero-layout">
        {!searched && <div className="hero-heading"><p className="eyebrow"><span className="signal-dot"/> TAVS SKATĪJUMS UZ TIRGU</p><h1>Laba izvēle.<br /><span>Skaidra cena.</span></h1><p>Atrodi īsto produktu. Ieraugi cenu atšķirību.<br />Izvēlies ar pārliecību.</p><div className="hero-coordinate" aria-hidden="true">RĪGA, LV <span>56°57′ N · 24°06′ E</span></div></div>}
        <div className="search-workspace">
          {!searched && <div className="discovery-orbit" aria-hidden="true"><span>OLED</span><span>16 GB</span><b>C<span>↗</span></b><span>5G</span><span>120 Hz</span></div>}
          <form className="search-shell" onSubmit={search}>
            <div className="mode-switch" role="group" aria-label="Meklēšanas režīms"><button type="button" aria-pressed={mode === 'search'} onClick={() => setMode('search')}>Meklēt produktu</button><button type="button" aria-pressed={mode === 'assistant'} onClick={() => setMode('assistant')}>✳ CENIQ AI</button></div>
            <label htmlFor="shopping-query">{mode === 'search' ? 'Ko šodien salīdzinām?' : 'Pastāsti, kas tev nepieciešams.'}</label>
            <div className="search-entry"><input id="shopping-query" maxLength={700} value={query} onChange={e => setQuery(e.target.value)} placeholder={mode === 'search' ? 'Produkta nosaukums vai modelis' : 'Vajadzība, budžets, svarīgās detaļas…'}/><button type="submit" disabled={loading} aria-label={mode === 'search' ? 'Meklēt' : 'Veidot AI atlasi'}>{loading ? '…' : '↗'}</button></div>
            <p className="search-hint">{mode === 'search' ? 'Modeļi, varianti un veikalu cenas vienuviet.' : 'Tavas prasības → reāli produkti → pamatota izvēle.'}</p>
          </form>
          <div className="search-examples"><span>Izmēģini</span>{(mode === 'search' ? examples : aiExamples).map(q => <button key={q} disabled={loading} onClick={() => search(undefined, q)}>{q} ↗</button>)}</div>
        </div>
      </div>
    </section>
    {(searched || loading) && <section className="container search-results" id="results" aria-live="polite" aria-busy={loading}>
      {loading && <div className="search-progress"><span className="signal-dot"/><h2>{mode === 'assistant' ? 'Veidojam tavu atlasi…' : 'Meklējam CENIQ katalogā…'}</h2><p>Salīdzinām zināmos produktus un piedāvājumus.</p></div>}
      {error && <div role="alert" className="errorbox">{error}<button onClick={() => search()}>Mēģināt vēlreiz</button></div>}
      {notice && <p className="notice">{notice}</p>}
      {plan && !loading && <header className="shortlist-heading"><span className="eyebrow">✳ CENIQ AI / TAVA ATLASE</span><h2>{query}</h2><p>{plan.summary}</p><div className="chips">{plan.constraints.map(c => <span key={c}>{c}</span>)}</div></header>}
      {!!recommendations.length && <AiShortlist items={recommendations} comparison={plan?.comparisonTargets.length === 2}/>}
      {!!results.length && <><header className="results-heading"><div><span className="eyebrow">CENU SALĪDZINĀJUMS</span><h2>{query}</h2></div><p>{visible.length} produktu grupas</p></header>
        <div className="filter-bar" aria-label="Rezultātu filtri">
          {brands.length > 1 && <label>Zīmols<select value={brand} onChange={e => setBrand(e.target.value)}><option value="">Visi</option>{brands.map(b => <option key={b}>{b}</option>)}</select></label>}
          {merchants.length > 1 && <label>Veikals<select value={merchant} onChange={e => setMerchant(e.target.value)}><option value="">Visi</option>{merchants.map(m => <option key={m}>{m}</option>)}</select></label>}
          <label>Cena līdz (€)<input type="number" min="1" value={ceiling} onChange={e => setCeiling(e.target.value)} placeholder="Bez limita"/></label>
          <label className="sort-control">Kārtot<select value={sort} onChange={e => setSort(e.target.value)}><option value="best">Labākā atbilstība</option><option value="price">Lētākā cena</option><option value="stores">Vairāk veikalu</option><option value="score">CENIQ vērtējums</option></select></label>
          {(brand || merchant || ceiling) && <button onClick={reset}>Notīrīt</button>}
        </div>
        {visible.length ? <div className="product-stream">{visible.map(p => <ProductCard product={p} query={query} key={p.id}/>)}</div> : <div className="emptybox">Šiem filtriem nav rezultātu. <button onClick={reset}>Notīrīt filtrus</button></div>}
      </>}
    </section>}
    {!searched && <div className="value-strip"><div className="container"><span>Veikalu cenas</span><span>Īstie varianti</span><span>Cenu vēsture</span><span>CENIQ vērtējums</span><span>AI atlase</span></div></div>}
    <section className="container category-section" id="kategorijas"><header className="section-heading"><div><span className="eyebrow">ATKLĀJ KATALOGU</span><h2>Katrai iecerei.<br />Katram ikdienas mirklim.</h2></div><p>Sāc ar kategoriju.<br />Nonāc līdz savai izvēlei.</p></header><div className="category-strip">{categories.map(([label, q, detail, n]) => <button key={q} onClick={() => search(undefined, q, 'search')} disabled={loading}><span>{n}</span><h3>{label}</h3><p>{detail}</p><b aria-hidden="true">↗</b></button>)}</div></section>
    {!!popular.length && <section className="container popular-section" id="populari"><span className="eyebrow">POPULĀRĀKIE MEKLĒJUMI</span><div>{popular.slice(0, 6).map((q, i) => <button key={q} onClick={() => search(undefined, q, 'search')} disabled={loading}><small>0{i + 1}</small>{q}<span>↗</span></button>)}</div></section>}
    <section className="how-section" id="ka-darbojas"><div className="container how-layout"><div><span className="eyebrow">KĀ TAS STRĀDĀ</span><h2>No daudzām cenām<br />līdz vienai skaidrai izvēlei.</h2><p>CENIQ salīdzina. Tu izlem.</p></div><ol>{[['Savācam', 'Publiski veikalu un katalogu dati veido meklēšanas pamatu.'], ['Sakārtojam', 'Vienādi modeļi vienkopus. Atšķirīgi varianti paliek atšķirīgi.'], ['Salīdzinām', 'Redzi veikalu cenas, cenu vēsturi un CENIQ vērtējumu.'], ['Palīdzam izvēlēties', 'Apraksti vajadzību. AI atlase izceļ atbilstību un to, kas vēl jāpārbauda.']].map(([title, description], i) => <li key={title}><span>0{i + 1}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol></div></section>
  </>;
}
