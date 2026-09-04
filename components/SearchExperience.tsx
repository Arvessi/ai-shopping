'use client';

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ProductCard from './ProductCard';
import type { AiShoppingPlan, ProductResult } from '@/lib/types';

const categories = [
  ['📱', 'Telefoni', 'smartphone'],
  ['💻', 'Portatīvie', 'laptop'],
  ['🖥️', 'Monitori', 'monitor'],
  ['📺', 'TV', 'OLED TV'],
  ['🎧', 'Audio', 'wireless headphones'],
  ['🎮', 'Gaming', 'gaming computer'],
  ['📷', 'Kameras', 'mirrorless camera'],
  ['🏠', 'Mājai', 'smart home electronics'],
];

const fallbackPopular = [
  'iPhone 16',
  'Samsung Galaxy S25',
  'MacBook Air',
  'OLED TV 55',
  'gaming laptop',
];

const SEARCH_STATE_KEY = 'ceniq-search-state-canonical-v1';

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

function groupCoverage(product: ProductResult) {
  return new Set(
    (product.offers || []).map((offer) =>
      String(offer.merchantDomain || offer.merchant || '').toLowerCase().replace(/^www\./, ''),
    ),
  ).size;
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
  const searchVersion = useRef(0);

  useEffect(() => {
    fetch('/api/popular')
      .then((response) => response.json())
      .then((data) => {
        if (data.searches?.length) setPopular(data.searches);
      })
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
        if (parsed.plan) setPlan(parsed.plan);
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
      // Ignore storage errors.
    }
  }, [restored, query, mode, results, notice, plan, source]);

  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      if (sortMode === 'price') {
        return (a.bestPrice || Number.MAX_SAFE_INTEGER) - (b.bestPrice || Number.MAX_SAFE_INTEGER);
      }

      if (sortMode === 'score') {
        return (
          (b.dealScore || 0) - (a.dealScore || 0) ||
          groupCoverage(b) - groupCoverage(a) ||
          (a.bestPrice || Number.MAX_SAFE_INTEGER) - (b.bestPrice || Number.MAX_SAFE_INTEGER)
        );
      }

      return (
        groupCoverage(b) - groupCoverage(a) ||
        (b.dealScore || 0) - (a.dealScore || 0) ||
        (a.bestPrice || Number.MAX_SAFE_INTEGER) - (b.bestPrice || Number.MAX_SAFE_INTEGER)
      );
    });
  }, [results, sortMode]);

  function updateUrl(searchQuery: string, searchMode: SearchMode) {
    const url = new URL(window.location.href);
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('mode', searchMode);
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  async function runExpansion(searchQuery: string, version: number, hadInitialResults: boolean) {
    try {
      setStatus(
        hadInitialResults
          ? 'Rezultāti gatavi — CENIQ fonā paplašina veikalu un variantu pārklājumu…'
          : 'CENIQ meklē Latvijas veikalos un Google Shopping…',
      );

      const response = await fetch('/api/search/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: searchQuery }),
        cache: 'no-store',
      });
      const data = await response.json();

      if (searchVersion.current !== version) return;

      if (!response.ok) {
        if (!hadInitialResults) {
          setNotice(data.error || 'Šoreiz neizdevās paplašināt meklēšanu.');
        }
        setStatus('');
        return;
      }

      const expanded = Array.isArray(data.results) ? data.results : [];
      if (expanded.length) {
        setResults(expanded);
        setSource(data.source || 'canonical-expanded');
        setNotice('');
      } else if (!hadInitialResults) {
        setNotice('Nekas netika atrasts. Pamēģini precīzāku modeļa nosaukumu.');
      }
      setStatus('');
    } catch {
      if (searchVersion.current === version) {
        if (!hadInitialResults) setNotice('Veikalu meklēšana neizdevās. Pamēģini vēlreiz.');
        setStatus('');
      }
    }
  }

  async function runSearch(searchQuery: string, searchMode: SearchMode) {
    const version = ++searchVersion.current;
    setStatus('CENIQ pārbauda katalogu…');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

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
      setSource(data.source || '');
      setSortMode('coverage');
      setNotice(
        nextResults.length === 0 && !data.expansion?.enabled
          ? data.message || 'Nekas netika atrasts.'
          : '',
      );

      if (data.expansion?.enabled) {
        void runExpansion(searchQuery, version, nextResults.length > 0);
      } else {
        setStatus('');
      }

      if (nextResults.length) {
        window.setTimeout(
          () =>
            document.getElementById('results')?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            }),
          60,
        );
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function submit(
    e?: FormEvent,
    override?: string,
    forcedMode?: SearchMode,
  ) {
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

    try {
      if (activeMode === 'assistant') {
        setStatus('CENIQ saprot tavas prasības…');
        const response = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: input }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'CENIQ AI neizdevās.');
        setPlan(data.plan);
        await runSearch(data.plan.searchQuery, 'assistant');
      } else {
        await runSearch(input, 'search');
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Kataloga pārbaude aizņēma pārāk ilgu laiku.'
            : err.message
          : 'Radās kļūda.',
      );
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  const sourceLabel =
    source === 'canonical-catalog'
      ? 'CENIQ katalogs'
      : source.startsWith('canonical-expanded')
        ? 'CENIQ katalogs papildināts'
        : source === 'canonical-enrichment'
          ? 'CENIQ katalogs atjaunināts'
          : '';

  return (
    <>
      <section className="hero" id="meklet">
        <div className="eyebrow">Latvijas cenu meklētājs</div>

        <h1>
          Atrodi labāko cenu.
          <br />
          <span>Pērc gudrāk.</span>
        </h1>

        <p>Viens produkts, varianti un veikalu cenas vienuviet.</p>

        <div className="modes">
          <button
            type="button"
            className={mode === 'search' ? 'active' : ''}
            onClick={() => setMode('search')}
          >
            ⌕ Meklēšana
          </button>
          <button
            type="button"
            className={mode === 'assistant' ? 'active' : ''}
            onClick={() => setMode('assistant')}
          >
            ✦ CENIQ AI
          </button>
        </div>

        <form className="bigsearch" onSubmit={(event: FormEvent<HTMLFormElement>) => submit(event)}>
          <span>⌕</span>
          <input
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            placeholder={
              mode === 'search'
                ? 'Piem., iPhone 16, MacBook Air, Sony WH-1000XM5'
                : 'Piem., portatīvais dators līdz 1200 € spēlēm'
            }
          />
          <button disabled={loading}>
            {loading ? 'Meklē…' : mode === 'assistant' ? 'Jautāt' : 'Meklēt'}
          </button>
        </form>

        {status && (
          <div className="searchstatus">
            <i />
            {status}
          </div>
        )}
        {error && <div className="errorbox">{error}</div>}
        {notice && !error && <div className="searchnotice">{notice}</div>}
      </section>

      {plan && (
        <section className="container aianswer">
          <div className="aibadge">✦ CENIQ</div>
          <h2>{plan.summary}</h2>
          {!!plan.constraints?.length && (
            <div className="chips">
              {plan.constraints.map((constraint: string) => (
                <span key={constraint}>{constraint}</span>
              ))}
            </div>
          )}
        </section>
      )}

      {results.length > 0 && (
        <section className="container results results-v32" id="results">
          <div className="sectiontitle resulttitle-v32">
            <div>
              <span>ATRASTIE PRODUKTI</span>
              <h2>Cenas un varianti</h2>
            </div>
            <div className="resultsource">
              {sourceLabel && <small>{sourceLabel}</small>}
              <b>
                {results.length}{' '}
                {results.length === 1 ? 'produktu grupa' : 'produktu grupas'}
              </b>
            </div>
          </div>

          {results.length > 1 && (
            <div className="results-sortbar">
              <span>Kārtot</span>
              <button
                type="button"
                className={sortMode === 'coverage' ? 'active' : ''}
                onClick={() => setSortMode('coverage')}
              >
                Vairāk veikalu
              </button>
              <button
                type="button"
                className={sortMode === 'price' ? 'active' : ''}
                onClick={() => setSortMode('price')}
              >
                Lētākā cena
              </button>
              <button
                type="button"
                className={sortMode === 'score' ? 'active' : ''}
                onClick={() => setSortMode('score')}
              >
                CENIQ score
              </button>
            </div>
          )}

          <div className="resultfamily-list">
            {sortedResults.map((product: ProductResult) => (
              <ProductCard
                product={product}
                query={query}
                key={`${product.id}:${product.title}`}
              />
            ))}
          </div>
        </section>
      )}

      <section className="container section" id="populari">
        <div className="sectiontitle">
          <div>
            <span>ŠOBRĪD MEKLĒ</span>
            <h2>Populārākie</h2>
          </div>
        </div>
        <div className="popularRow">
          {popular.map((item: string, index: number) => (
            <button
              type="button"
              key={item}
              onClick={() => submit(undefined, item, 'search')}
            >
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
          {categories.map(([icon, label, searchQuery]) => (
            <button
              type="button"
              key={label}
              onClick={() => submit(undefined, searchQuery, 'search')}
            >
              <span>{icon}</span>
              <b>{label}</b>
              <i>→</i>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
