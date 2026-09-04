'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import ProductCard from './ProductCard';
import type { AiShoppingPlan, ProductResult } from '@/lib/types';

const categories = [
  { label: 'Telefoni', detail: 'Viedtālruņi un ierīces', query: 'smartphone' },
  { label: 'Datori', detail: 'Portatīvie un darba stacijas', query: 'laptop' },
  { label: 'Monitori', detail: 'Darba un spēļu monitori', query: 'monitor' },
  { label: 'TV', detail: 'OLED, QLED un 4K', query: 'TV' },
  { label: 'Audio', detail: 'Austiņas un skaņa', query: 'headphones' },
  { label: 'Gaming', detail: 'Datori un spēļu tehnika', query: 'gaming' },
  { label: 'Kameras', detail: 'Foto un video', query: 'camera' },
  { label: 'Sadzīves tehnika', detail: 'Tehnika mājai', query: 'home appliance' },
  { label: 'Sports', detail: 'Treniņiem un brīvā dabā', query: 'sports' },
  { label: 'Velo', detail: 'Velosipēdi un aprīkojums', query: 'bike' },
  { label: 'Skaistums', detail: 'Kosmētika un kopšana', query: 'beauty' },
  { label: 'Bērniem', detail: 'Rotaļlietas un preces', query: 'toys' },
];

const fallbackPopular = ['iPhone 16', 'Samsung Galaxy S25', 'Lenovo Legion 5', 'Sony WH-1000XM5', 'LG OLED C4'];
const SEARCH_STATE_KEY = 'ceniq-search-state-v4';

type SearchMode = 'search' | 'assistant';
type SortMode = 'coverage' | 'price' | 'score';

type SavedSearchState = {
  query: string;
  mode: SearchMode;
  results: ProductResult[];
  notice: string;
  plan: AiShoppingPlan | null;
  source?: string;
};

function merchantKey(value: { merchantDomain?: string; merchant?: string }) {
  return String(value.merchantDomain || value.merchant || '').toLowerCase().replace(/^www\./, '');
}

function groupCoverage(product: ProductResult) {
  return product.storesCount || new Set((product.offers || []).map(merchantKey).filter(Boolean)).size;
}

function groupBestPrice(product: ProductResult) {
  if (Number.isFinite(product.bestPrice) && product.bestPrice > 0) return product.bestPrice;
  const prices = (product.offers || []).map((offer) => Number(offer.totalPrice)).filter((price) => Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) : Number.MAX_SAFE_INTEGER;
}

function groupBestScore(product: ProductResult) {
  return Math.max(Number(product.dealScore || 0), ...(product.offers || []).map((offer) => Number(offer.dealScore || 0)));
}

function groupVariantCount(product: ProductResult) {
  return (product.catalogVariants || []).filter((variant) => variant.offerCount > 0).length;
}

export default function SearchExperience() {
  const [mode, setMode] = useState<SearchMode>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductResult[]>([]);
  const [popular, setPopular] = useState<string[]>(fallbackPopular);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [plan, setPlan] = useState<AiShoppingPlan | null>(null);
  const [source, setSource] = useState('');
  const [restored, setRestored] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('coverage');
  const [brandFilter, setBrandFilter] = useState('all');
  const [minStores, setMinStores] = useState(0);
  const [maxPrice, setMaxPrice] = useState('');
  const searchVersion = useRef(0);

  useEffect(() => {
    fetch('/api/popular')
      .then((response) => response.json())
      .then((data) => { if (data.searches?.length) setPopular(data.searches); })
      .catch(() => undefined);

    try {
      const saved = window.sessionStorage.getItem(SEARCH_STATE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<SavedSearchState>;
        if (typeof parsed.query === 'string') setQuery(parsed.query);
        if (parsed.mode === 'assistant' || parsed.mode === 'search') setMode(parsed.mode);
        if (Array.isArray(parsed.results)) setResults(parsed.results);
        if (typeof parsed.notice === 'string') setNotice(parsed.notice);
        if (typeof parsed.source === 'string') setSource(parsed.source);
        if (parsed.plan) {
          setPlan(parsed.plan);
          if (parsed.plan.maxPrice) setMaxPrice(String(parsed.plan.maxPrice));
        }
      } else {
        const params = new URLSearchParams(window.location.search);
        const q = params.get('q');
        const m = params.get('mode');
        if (q) setQuery(q);
        if (m === 'assistant') setMode('assistant');
      }
    } catch {
      window.sessionStorage.removeItem(SEARCH_STATE_KEY);
    } finally {
      setRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!restored) return;
    const state: SavedSearchState = { query, mode, results, notice, plan, source };
    try {
      window.sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(state));
    } catch {
      // Search remains fully usable when sessionStorage is unavailable.
    }
  }, [restored, query, mode, results, notice, plan, source]);

  const brands = useMemo(() => Array.from(new Set(results.map((product) => product.brand?.trim()).filter((brand): brand is string => Boolean(brand)))).sort((a, b) => a.localeCompare(b)), [results]);

  const visibleResults = useMemo(() => {
    const ceiling = maxPrice ? Number(maxPrice.replace(',', '.')) : 0;
    const filtered = results.filter((product) => {
      if (brandFilter !== 'all' && product.brand !== brandFilter) return false;
      if (minStores > 0 && groupCoverage(product) < minStores) return false;
      if (Number.isFinite(ceiling) && ceiling > 0 && groupBestPrice(product) > ceiling) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'price') return groupBestPrice(a) - groupBestPrice(b) || groupCoverage(b) - groupCoverage(a);
      if (sortMode === 'score') return groupBestScore(b) - groupBestScore(a) || groupCoverage(b) - groupCoverage(a) || groupBestPrice(a) - groupBestPrice(b);
      return groupCoverage(b) - groupCoverage(a) || groupVariantCount(b) - groupVariantCount(a) || groupBestScore(b) - groupBestScore(a) || groupBestPrice(a) - groupBestPrice(b);
    });
  }, [results, sortMode, brandFilter, minStores, maxPrice]);

  function updateUrl(searchQuery: string, searchMode: SearchMode) {
    const url = new URL(window.location.href);
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('mode', searchMode);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function resetFilters() {
    setBrandFilter('all');
    setMinStores(0);
    setMaxPrice('');
  }

  async function runSearch(searchQuery: string, searchMode: SearchMode) {
    const version = ++searchVersion.current;
    setStatus('Pārbauda CENIQ katalogu…');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: searchQuery, mode: searchMode }),
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json();
      if (searchVersion.current !== version) return;
      if (!response.ok) throw new Error(data.error || 'Meklēšana neizdevās.');

      const nextResults = Array.isArray(data.results) ? data.results : [];
      setResults(nextResults);
      setSource(data.source || '');
      setSortMode('coverage');
      setNotice(nextResults.length ? '' : data.message || 'Nekas netika atrasts.');
      setStatus('');

      if (nextResults.length) {
        window.setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function submit(e?: FormEvent, override?: string, forcedMode?: SearchMode) {
    e?.preventDefault();
    const activeMode = forcedMode ?? mode;
    const input = (override ?? query).trim();
    if (!input || loading) return;

    setQuery(input);
    setMode(activeMode);
    updateUrl(input, activeMode);
    setLoading(true);
    setError('');
    setNotice('');
    setResults([]);
    setPlan(null);
    setSource('');
    resetFilters();

    try {
      if (activeMode === 'assistant') {
        setStatus('CENIQ AI saprot tavas prasības…');
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: input }),
            cache: 'no-store',
            signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'CENIQ AI neizdevās.');
          const nextPlan = data.plan as AiShoppingPlan;
          setPlan(nextPlan);
          if (nextPlan.maxPrice) setMaxPrice(String(nextPlan.maxPrice));
          await runSearch(nextPlan.searchQuery, 'assistant');
        } finally {
          window.clearTimeout(timeout);
        }
      } else {
        await runSearch(input, 'search');
      }
    } catch (err) {
      setError(err instanceof Error
        ? err.name === 'AbortError' ? 'Meklēšana aizņēma pārāk ilgu laiku. Pamēģini vēlreiz.' : err.message
        : 'Radās kļūda.');
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  const sourceLabel = source === 'canonical-catalog' ? 'CENIQ katalogs · aktuālie piedāvājumi' : '';
  const filtersActive = brandFilter !== 'all' || minStores > 0 || Boolean(maxPrice);

  return (
    <>
      <section className="hero" id="meklet">
        <div className="hero-inner">
          <div className="eyebrow">Cenu salīdzināšana bez lieka trokšņa</div>
          <h1>Atrodi produktu.<br /><span>Salīdzini īsto cenu.</span></h1>
          <p>CENIQ apkopo aktuālus veikalu piedāvājumus vienā katalogā — ar variantiem, pieejamību un cenu salīdzinājumu.</p>

          <div className="modes" role="tablist" aria-label="Meklēšanas režīms">
            <button type="button" className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>Meklēt produktu</button>
            <button type="button" className={mode === 'assistant' ? 'active' : ''} onClick={() => setMode('assistant')}>CENIQ AI</button>
          </div>

          <form className="bigsearch" onSubmit={(event: FormEvent<HTMLFormElement>) => submit(event)}>
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              aria-label={mode === 'search' ? 'Meklējamais produkts' : 'Apraksti vajadzīgo produktu'}
              placeholder={mode === 'search' ? 'Samsung Galaxy S25, iPhone 16, Lenovo Legion 5…' : 'Piem., OLED TV līdz 1000 € ar 120 Hz'}
            />
            <button disabled={loading}>{loading ? 'Meklē…' : mode === 'assistant' ? 'Atrast ar AI' : 'Salīdzināt'}</button>
          </form>

          <div className="hero-proof"><span>0 ārējo API zvanu meklēšanas brīdī</span><span>Svaigs CENIQ katalogs</span><span>Varianti netiek jaukti</span></div>
          {status && <div className="searchstatus"><i />{status}</div>}
          {error && <div className="errorbox">{error}</div>}
          {notice && !error && <div className="searchnotice">{notice}</div>}
        </div>
      </section>

      {plan && (
        <section className="container aianswer">
          <div className="aibadge">CENIQ AI PLĀNS</div>
          <h2>{plan.summary}</h2>
          {!!plan.constraints?.length && <div className="chips">{plan.constraints.map((constraint) => <span key={constraint}>{constraint}</span>)}</div>}
        </section>
      )}

      {results.length > 0 && (
        <section className="container results results-v32" id="results">
          <div className="sectiontitle resulttitle-v32">
            <div><span>ATRastie PRODUKTI</span><h2>Cenas un varianti</h2></div>
            <div className="resultsource">{sourceLabel && <small>{sourceLabel}</small>}<b>{visibleResults.length} no {results.length} produktu grupām</b></div>
          </div>

          <div className="catalog-toolbar">
            <div className="catalog-filters" aria-label="Rezultātu filtri">
              <label>
                <span>Zīmols</span>
                <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>
                  <option value="all">Visi zīmoli</option>
                  {brands.map((brand) => <option value={brand} key={brand}>{brand}</option>)}
                </select>
              </label>
              <label>
                <span>Veikalu skaits</span>
                <select value={minStores} onChange={(event) => setMinStores(Number(event.target.value))}>
                  <option value={0}>Jebkurš</option>
                  <option value={2}>Vismaz 2</option>
                  <option value={3}>Vismaz 3</option>
                  <option value={5}>Vismaz 5</option>
                </select>
              </label>
              <label>
                <span>Maksimālā cena</span>
                <div className="price-filter"><input inputMode="decimal" type="number" min="1" step="1" placeholder="Bez limita" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} /><b>€</b></div>
              </label>
              {filtersActive && <button type="button" className="clearfilters" onClick={resetFilters}>Notīrīt filtrus</button>}
            </div>

            <div className="results-sortbar">
              <span>Kārtot</span>
              <button type="button" className={sortMode === 'coverage' ? 'active' : ''} onClick={() => setSortMode('coverage')}>Vairāk veikalu</button>
              <button type="button" className={sortMode === 'price' ? 'active' : ''} onClick={() => setSortMode('price')}>Lētākā cena</button>
              <button type="button" className={sortMode === 'score' ? 'active' : ''} onClick={() => setSortMode('score')}>CENIQ score</button>
            </div>
          </div>

          {visibleResults.length ? (
            <div className="resultfamily-list">{visibleResults.map((product) => <ProductCard product={product} query={query} key={`${product.id}:${product.title}`} />)}</div>
          ) : (
            <div className="filterempty filterempty-large"><b>Šiem filtriem nav rezultātu.</b><span>Samazini ierobežojumus vai notīri filtrus.</span><button type="button" onClick={resetFilters}>Notīrīt filtrus</button></div>
          )}
        </section>
      )}

      <section className="container section" id="populari">
        <div className="sectiontitle"><div><span>ĀTRS STARTS</span><h2>Populāri meklējumi</h2></div><p>Viens klikšķis līdz cenu salīdzinājumam.</p></div>
        <div className="popularRow">
          {popular.slice(0, 5).map((item, index) => (
            <button type="button" key={item} onClick={() => submit(undefined, item, 'search')}><b>{String(index + 1).padStart(2, '0')}</b><span>{item}</span><i>↗</i></button>
          ))}
        </div>
      </section>

      <section className="container section" id="kategorijas">
        <div className="sectiontitle"><div><span>KATALOGS</span><h2>Kategorijas</h2></div><p>CENIQ arhitektūra nav piesieta tikai elektronikai.</p></div>
        <div className="categorygrid categorygrid-v4">
          {categories.map((category, index) => (
            <button type="button" key={category.label} onClick={() => submit(undefined, category.query, 'search')}>
              <small>{String(index + 1).padStart(2, '0')}</small><b>{category.label}</b><span>{category.detail}</span><i>→</i>
            </button>
          ))}
        </div>
      </section>

      <section className="container how how-v4" id="ka-darbojas">
        <div className="howintro"><span>KĀ TAS STRĀDĀ</span><h2>Meklē katalogā, nevis gaidi internetu.</h2><p>Veikalu dati tiek savākti un normalizēti iepriekš. Tāpēc parasta CENIQ meklēšana ir ātra un neizsauc maksas meklētājus katram klikšķim.</p></div>
        <div className="howgrid">
          <article><b>01</b><h3>Atrodam piedāvājumus</h3><p>Publiski feedi, sitemap un veikalu katalogu avoti tiek apstrādāti kontrolētos batchos.</p></article>
          <article><b>02</b><h3>Saliekam variantus</h3><p>GTIN, MPN, modelis un specifikācijas palīdz nesajaukt atmiņu, krāsu un citus variantus.</p></article>
          <article><b>03</b><h3>Tu salīdzini</h3><p>Meklēšana lasa CENIQ datubāzi un rāda svaigos veikalu piedāvājumus vienā skatā.</p></article>
        </div>
      </section>
    </>
  );
}
