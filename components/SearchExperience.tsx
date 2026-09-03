'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import ProductCard from './ProductCard';
import type { AiShoppingPlan, ProductResult } from '@/lib/types';

const categories = [
  ['📱', 'Telefoni', 'smartphone'],
  ['💻', 'Portatīvie', 'laptop'],
  ['🖥️', 'Monitori', 'gaming monitor'],
  ['📺', 'TV', 'OLED TV'],
  ['🎧', 'Audio', 'wireless headphones'],
  ['🎮', 'Gaming', 'gaming accessories'],
  ['📷', 'Kameras', 'mirrorless camera'],
  ['🏠', 'Mājai', 'smart home electronics'],
];

const fallbackPopular = ['iPhone 17 Pro', 'gaming monitors 240Hz', 'OLED TV 55', 'MacBook Air', 'wireless headphones'];
const SEARCH_STATE_KEY = 'ceniq-search-state-v1';

type SearchMode = 'search' | 'assistant';

type SavedSearchState = {
  query: string;
  mode: SearchMode;
  results: ProductResult[];
  notice: string;
  plan: AiShoppingPlan | null;
};

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
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    fetch('/api/popular')
      .then((response) => response.json())
      .then((data) => data.searches?.length && setPopular(data.searches))
      .catch(() => undefined);

    try {
      const saved = window.sessionStorage.getItem(SEARCH_STATE_KEY);

      if (saved) {
        const parsed = JSON.parse(saved) as Partial<SavedSearchState>;

        if (typeof parsed.query === 'string') setQuery(parsed.query);
        if (parsed.mode === 'assistant' || parsed.mode === 'search') setMode(parsed.mode);
        if (Array.isArray(parsed.results)) setResults(parsed.results);
        if (typeof parsed.notice === 'string') setNotice(parsed.notice);
        if (parsed.plan) setPlan(parsed.plan);
      } else {
        const params = new URLSearchParams(window.location.search);
        const urlQuery = params.get('q');
        const urlMode = params.get('mode');

        if (urlQuery) setQuery(urlQuery);
        if (urlMode === 'assistant' || urlMode === 'search') setMode(urlMode);
      }
    } catch {
      window.sessionStorage.removeItem(SEARCH_STATE_KEY);
    } finally {
      setRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!restored) return;

    const state: SavedSearchState = {
      query,
      mode,
      results,
      notice,
      plan,
    };

    try {
      window.sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(state));
    } catch {
      // sessionStorage can be unavailable in strict/private browser modes.
    }
  }, [restored, query, mode, results, notice, plan]);

  function updateSearchUrl(searchQuery: string, searchMode: SearchMode) {
    const url = new URL(window.location.href);

    if (searchQuery) url.searchParams.set('q', searchQuery);
    else url.searchParams.delete('q');

    url.searchParams.set('mode', searchMode);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  async function runDataSearch(searchQuery: string, searchMode: SearchMode) {
    setStatus('Meklējam cenas…');
    setNotice('');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: searchQuery, mode: searchMode }),
        signal: controller.signal,
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Meklēšana neizdevās.');

      const nextResults = Array.isArray(data.results) ? data.results : [];
      setResults(nextResults);
      setNotice(
        nextResults.length === 0
          ? data.message || 'Nekas netika atrasts. Pamēģini precīzāku produkta nosaukumu.'
          : '',
      );
      setStatus('');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Meklēšana pārsniedza 30 sekundes. Pamēģini vēlreiz.');
      }
      throw err;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function submit(e?: FormEvent, override?: string, forcedMode?: SearchMode) {
    e?.preventDefault();

    const activeMode = forcedMode ?? mode;
    const input = (override ?? query).trim();
    if (!input || loading) return;

    if (override) setQuery(override);
    if (forcedMode) setMode(forcedMode);

    updateSearchUrl(input, activeMode);

    setLoading(true);
    setError('');
    setNotice('');
    setResults([]);
    setPlan(null);

    try {
      if (activeMode === 'assistant') {
        setStatus('Ceniq AI saprot tavas prasības…');

        const ai = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: input }),
        });

        const aiData = await ai.json();
        if (!ai.ok) throw new Error(aiData.error || 'Ceniq AI neizdevās.');

        setPlan(aiData.plan);
        await runDataSearch(aiData.plan.searchQuery, 'assistant');
      } else {
        await runDataSearch(input, 'search');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Radās kļūda.');
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="hero" id="meklet">
        <div className="eyebrow">Latvijas cenu meklētājs + AI</div>
        <h1>
          Atrodi labāko cenu.<br />
          <span>Pērc gudrāk.</span>
        </h1>
        <p>Ceniq salīdzina produktus, veikalu piedāvājumus un piegādi vienuviet.</p>

        <div className="modes">
          <button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>
            ⌕ Parastā meklēšana
          </button>
          <button className={mode === 'assistant' ? 'active' : ''} onClick={() => setMode('assistant')}>
            ✦ Ceniq AI
          </button>
        </div>

        <form className="bigsearch" onSubmit={(e: FormEvent<HTMLFormElement>) => submit(e)}>
          <span>{mode === 'search' ? '⌕' : '✦'}</span>
          <input
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder={
              mode === 'search'
                ? 'Piem., iPhone 17 Pro 256GB'
                : 'Piem., gaming monitors līdz 300 €, vismaz 144Hz un 27 collas'
            }
          />
          <button disabled={loading}>{loading ? 'Meklē…' : mode === 'search' ? 'Meklēt' : 'Jautāt AI'}</button>
        </form>

        {status && (
          <div className="searchstatus">
            <i></i>
            {status}
          </div>
        )}
        {error && <div className="errorbox">{error}</div>}
        {notice && !error && <div className="searchstatus">{notice}</div>}
      </section>

      {plan && (
        <section className="container aianswer">
          <div className="aibadge">✦ Ceniq AI</div>
          <h2>{plan.summary}</h2>
          <div className="chips">
            {plan.constraints.map((constraint: string) => (
              <span key={constraint}>{constraint}</span>
            ))}
          </div>
        </section>
      )}

      {results.length > 0 && (
        <section className="container results">
          <div className="sectiontitle">
            <div>
              <span>ATRASTIE PRODUKTI</span>
              <h2>Labākās izvēles</h2>
            </div>
            <p>{results.length} sagrupēti produkti</p>
          </div>
          <div className="productgrid">
            {results.map((product: ProductResult) => (
              <ProductCard product={product} key={product.id} />
            ))}
          </div>
        </section>
      )}

      <section className="container section" id="populari">
        <div className="sectiontitle">
          <div>
            <span>ŠOBRĪD MEKLĒ</span>
            <h2>Populārākie meklējumi</h2>
          </div>
        </div>
        <div className="popularRow">
          {popular.map((item: string, index: number) => (
            <button key={item} onClick={() => submit(undefined, item)}>
              <b>{String(index + 1).padStart(2, '0')}</b>
              <span>{item}</span>
              <i>↗</i>
            </button>
          ))}
        </div>
      </section>

      <section className="container section">
        <div className="sectiontitle">
          <div>
            <span>ĀTRĀ PIEKĻUVE</span>
            <h2>Kategorijas</h2>
          </div>
        </div>
        <div className="categorygrid">
          {categories.map(([icon, label, q]) => (
            <button key={label} onClick={() => submit(undefined, q, 'search')}>
              <span>{icon}</span>
              <b>{label}</b>
              <i>→</i>
            </button>
          ))}
        </div>
      </section>

      <section className="container how" id="ka-darbojas">
        <div className="howintro">
          <span>KĀ DARBOJAS CENIQ?</span>
          <h2>No vajadzības līdz labākajam piedāvājumam.</h2>
          <p>Tu izvēlies — precīzs produkts vai saruna ar AI. Ceniq izdara salīdzināšanu.</p>
        </div>
        <div className="howgrid">
          <article>
            <b>01</b>
            <h3>Meklē produktu</h3>
            <p>Ieraksti modeli, ko jau zini. Ceniq grupē viena produkta piedāvājumus no dažādiem veikaliem.</p>
          </article>
          <article>
            <b>02</b>
            <h3>Vai apraksti vajadzību</h3>
            <p>Ceniq AI pārvērš tavas prasības konkrētos parametros un atrod atbilstošākos produktus.</p>
          </article>
          <article>
            <b>03</b>
            <h3>Izvēlies gudrāk</h3>
            <p>Cena, piegāde un tirgotāja signāli tiek apvienoti Ceniq vērtējumā, lai lētākais nebūtu vienīgais kritērijs.</p>
          </article>
        </div>
      </section>
    </>
  );
}
