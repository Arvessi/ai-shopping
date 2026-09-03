'use client';

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import ProductCard from './ProductCard';
import type {
  AiShoppingPlan,
  ProductResult,
} from '@/lib/types';

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

const fallbackPopular = [
  'iPhone 17 Pro',
  'gaming monitors 240Hz',
  'OLED TV 55',
  'MacBook Air',
  'wireless headphones',
];

const SEARCH_STATE_KEY = 'ceniq-search-state-v3';

type SearchMode = 'search' | 'assistant';
type SortMode = 'recommended' | 'price' | 'coverage';

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

  const [brandFilter, setBrandFilter] = useState('all');
  const [storeFilter, setStoreFilter] = useState('all');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recommended');

  useEffect(() => {
    fetch('/api/popular')
      .then((response) => response.json())
      .then((data) => {
        if (data.searches?.length) {
          setPopular(data.searches);
        }
      })
      .catch(() => undefined);

    try {
      const saved = window.sessionStorage.getItem(SEARCH_STATE_KEY);

      if (saved) {
        const parsed = JSON.parse(saved) as Partial<SavedSearchState>;

        if (typeof parsed.query === 'string') {
          setQuery(parsed.query);
        }

        if (parsed.mode === 'assistant' || parsed.mode === 'search') {
          setMode(parsed.mode);
        }

        if (Array.isArray(parsed.results)) {
          setResults(parsed.results);
        }

        if (typeof parsed.notice === 'string') {
          setNotice(parsed.notice);
        }

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

    const state: SavedSearchState = {
      query,
      mode,
      results,
      notice,
      plan,
    };

    try {
      window.sessionStorage.setItem(
        SEARCH_STATE_KEY,
        JSON.stringify(state),
      );
    } catch {
      // Ignore private-mode storage errors.
    }
  }, [restored, query, mode, results, notice, plan]);

  const brands = useMemo(
    () =>
      Array.from(
        new Set(
          results
            .map((product) => product.brand)
            .filter(Boolean) as string[],
        ),
      ).sort(),
    [results],
  );

  const stores = useMemo(
    () =>
      Array.from(
        new Set(
          results.flatMap((product) =>
            product.offers.map((offer) => offer.merchant),
          ),
        ),
      ).sort(),
    [results],
  );

  const filteredResults = useMemo(() => {
    const limit = Number(maxPrice);

    const filtered = results.filter((product) => {
      if (
        brandFilter !== 'all' &&
        product.brand !== brandFilter
      ) {
        return false;
      }

      if (
        storeFilter !== 'all' &&
        !product.offers.some(
          (offer) => offer.merchant === storeFilter,
        )
      ) {
        return false;
      }

      if (
        maxPrice &&
        Number.isFinite(limit) &&
        product.bestPrice > limit
      ) {
        return false;
      }

      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'price') {
        return a.bestPrice - b.bestPrice;
      }

      if (sortMode === 'coverage') {
        return (
          (b.storesCount || b.offers.length) -
            (a.storesCount || a.offers.length) ||
          a.bestPrice - b.bestPrice
        );
      }

      return (
        (b.storesCount || b.offers.length) -
          (a.storesCount || a.offers.length) ||
        b.dealScore - a.dealScore ||
        a.bestPrice - b.bestPrice
      );
    });
  }, [
    results,
    brandFilter,
    storeFilter,
    maxPrice,
    sortMode,
  ]);

  function resetFilters() {
    setBrandFilter('all');
    setStoreFilter('all');
    setMaxPrice('');
    setSortMode('recommended');
  }

  function updateUrl(
    searchQuery: string,
    searchMode: SearchMode,
  ) {
    const url = new URL(window.location.href);
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('mode', searchMode);

    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  async function runSearch(
    searchQuery: string,
    searchMode: SearchMode,
  ) {
    setStatus('Meklējam un grupējam piedāvājumus…');

    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      30000,
    );

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: searchQuery,
          mode: searchMode,
        }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Meklēšana neizdevās.');
      }

      const nextResults = Array.isArray(data.results)
        ? data.results
        : [];

      setResults(nextResults);
      resetFilters();

      setNotice(
        nextResults.length === 0
          ? data.message || 'Nekas netika atrasts.'
          : data.cached
            ? 'Rezultāti no CENIQ kešatmiņas.'
            : '',
      );

      setStatus('');

      if (nextResults.length) {
        window.setTimeout(() => {
          document
            .getElementById('results')
            ?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            });
        }, 60);
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

    document
      .getElementById('meklet')
      ?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });

    setLoading(true);
    setError('');
    setNotice('');
    setResults([]);
    setPlan(null);

    try {
      if (activeMode === 'assistant') {
        setStatus('CENIQ saprot tavas prasības…');

        const response = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: input }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'CENIQ AI neizdevās.');
        }

        setPlan(data.plan);
        await runSearch(data.plan.searchQuery, 'assistant');
      } else {
        await runSearch(input, 'search');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Radās kļūda.',
      );
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="hero" id="meklet">
        <div className="eyebrow">
          Latvijas cenu meklētājs
        </div>

        <h1>
          Atrodi labāko cenu.
          <br />
          <span>Pērc gudrāk.</span>
        </h1>

        <p>
          CENIQ grupē vienu produktu, atrod veikalus
          un palīdz saprast, kurš piedāvājums ir jēdzīgs.
        </p>

        <div className="modes">
          <button
            className={mode === 'search' ? 'active' : ''}
            onClick={() => setMode('search')}
          >
            ⌕ Meklēšana
          </button>

          <button
            className={mode === 'assistant' ? 'active' : ''}
            onClick={() => setMode('assistant')}
          >
            ✦ CENIQ AI
          </button>
        </div>

        <form
          className="bigsearch"
          onSubmit={(e: FormEvent<HTMLFormElement>) => submit(e)}
        >
          <span>⌕</span>

          <input
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setQuery(e.target.value)
            }
            placeholder={
              mode === 'search'
                ? 'Piem., iPhone 16 128GB'
                : 'Piem., 27 collu 144Hz monitors līdz 300 €'
            }
          />

          <button disabled={loading}>
            {loading
              ? 'Meklē…'
              : mode === 'assistant'
                ? 'Jautāt'
                : 'Meklēt'}
          </button>
        </form>

        {status && (
          <div className="searchstatus">
            <i />
            {status}
          </div>
        )}

        {error && <div className="errorbox">{error}</div>}

        {notice && !error && (
          <div className="searchnotice">{notice}</div>
        )}
      </section>

      {plan && (
        <section className="container aianswer">
          <div className="aibadge">✦ CENIQ</div>
          <h2>{plan.summary}</h2>

          <div className="chips">
            {plan.constraints.map((constraint) => (
              <span key={constraint}>{constraint}</span>
            ))}
          </div>
        </section>
      )}

      {results.length > 0 && (
        <section
          className="container results"
          id="results"
        >
          <div className="sectiontitle">
            <div>
              <span>ATRASTIE PRODUKTI</span>
              <h2>Labākās izvēles</h2>
            </div>

            <p>{results.length} produktu grupas</p>
          </div>

          <div className="smartfilters">
            <div className="sortpills">
              <button
                className={
                  sortMode === 'recommended' ? 'active' : ''
                }
                onClick={() => setSortMode('recommended')}
              >
                CENIQ iesaka
              </button>

              <button
                className={
                  sortMode === 'price' ? 'active' : ''
                }
                onClick={() => setSortMode('price')}
              >
                Lētākie
              </button>

              <button
                className={
                  sortMode === 'coverage' ? 'active' : ''
                }
                onClick={() => setSortMode('coverage')}
              >
                Vairāk veikalu
              </button>
            </div>

            <div className="facetfilters">
              {brands.length > 1 && (
                <label>
                  <span>Zīmols</span>
                  <select
                    value={brandFilter}
                    onChange={(e) =>
                      setBrandFilter(e.target.value)
                    }
                  >
                    <option value="all">Visi</option>
                    {brands.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {stores.length > 1 && (
                <label>
                  <span>Veikals</span>
                  <select
                    value={storeFilter}
                    onChange={(e) =>
                      setStoreFilter(e.target.value)
                    }
                  >
                    <option value="all">Visi</option>
                    {stores.map((store) => (
                      <option key={store} value={store}>
                        {store}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label>
                <span>Cena līdz</span>
                <input
                  type="number"
                  min="0"
                  placeholder="€"
                  value={maxPrice}
                  onChange={(e) =>
                    setMaxPrice(e.target.value)
                  }
                />
              </label>

              {(brandFilter !== 'all' ||
                storeFilter !== 'all' ||
                maxPrice ||
                sortMode !== 'recommended') && (
                <button
                  className="filterreset"
                  onClick={resetFilters}
                >
                  Notīrīt
                </button>
              )}
            </div>
          </div>

          <div className="resultsmeta">
            {filteredResults.length} no {results.length} produktu grupām
          </div>

          <div className="productgrid">
            {filteredResults.map((product) => (
              <ProductCard
                product={product}
                key={product.id}
              />
            ))}
          </div>
        </section>
      )}

      <section
        className="container section"
        id="populari"
      >
        <div className="sectiontitle">
          <div>
            <span>ŠOBRĪD MEKLĒ</span>
            <h2>Populārākie</h2>
          </div>
        </div>

        <div className="popularRow">
          {popular.map((item, index) => (
            <button
              key={item}
              onClick={() =>
                submit(undefined, item, 'search')
              }
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
              key={label}
              onClick={() =>
                submit(undefined, searchQuery, 'search')
              }
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
