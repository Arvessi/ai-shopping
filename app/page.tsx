'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { ProductResult } from '../lib/types';

const categories = [
  'Electronics',
  'Phones',
  'Laptops',
  'Monitors',
  'TVs',
  'Audio',
  'Gaming',
  'Home',
];

function formatPrice(price: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${price.toFixed(2)} ${currency}`;
  }
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'search' | 'assistant'>('search');
  const [results, setResults] = useState<ProductResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchStatus, setSearchStatus] = useState('');

  const heading = useMemo(
    () =>
      mode === 'search'
        ? 'Find exactly what you want.'
        : 'Tell AI what you need.',
    [mode]
  );

  async function submit(e: FormEvent) {
    e.preventDefault();

    if (!query.trim() || loading) return;

    setLoading(true);
    setError('');
    setSearchStatus('Creating search…');
    setResults([]);

    try {
      // Create DataForSEO task
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(query.trim())}`,
        {
          cache: 'no-store',
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Search failed.');
      }

      // In case the API returns results immediately
      if (Array.isArray(data.results) && data.results.length > 0) {
        setResults(data.results);
        setSearchStatus('');
        return;
      }

      const taskId = data.taskId;

      if (!taskId) {
        throw new Error('Search task was not created.');
      }

      // DataForSEO can take longer than a few seconds.
      // Wait up to ~2 minutes instead of giving up after ~18 seconds.
      const maxAttempts = 60;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const poll = await fetch(
          `/api/search?taskId=${encodeURIComponent(taskId)}`,
          {
            cache: 'no-store',
          }
        );

        const pollData = await poll.json();

        if (!poll.ok) {
          throw new Error(pollData.error || 'Search failed.');
        }

        if (pollData.error) {
          throw new Error(pollData.error);
        }

        if (pollData.pending) {
          const status = pollData.statusMessage || 'Searching…';

          setSearchStatus(
            attempt < 3
              ? 'Starting search…'
              : `Searching… ${status}`
          );

          continue;
        }

        const nextResults = Array.isArray(pollData.results)
          ? pollData.results
          : [];

        if (!nextResults.length) {
          throw new Error(
            'No matching shopping results were found.'
          );
        }

        setResults(nextResults);
        setSearchStatus('');
        return;
      }

      throw new Error(
        'The search is taking longer than expected. Please try again.'
      );
    } catch (error) {
      setResults([]);
      setSearchStatus('');
      setError(
        error instanceof Error
          ? error.message
          : 'Search failed.'
      );
    } finally {
      setLoading(false);
    }
  }

  const demoResults: ProductResult[] = [
    {
      id: 'demo1',
      title: 'Apple iPhone 17 256GB',
      brand: 'Apple',
      category: 'Phones',
      bestPrice: 899,
      currency: 'EUR',
      dealScore: 91,
      offers: [],
    },
    {
      id: 'demo2',
      title: '27" QHD 240Hz OLED Gaming Monitor',
      brand: 'DemoBrand',
      category: 'Monitors',
      bestPrice: 549,
      currency: 'EUR',
      dealScore: 88,
      offers: [],
    },
    {
      id: 'demo3',
      title: '55" 4K OLED 120Hz Smart TV',
      brand: 'DemoVision',
      category: 'TVs',
      bestPrice: 999,
      currency: 'EUR',
      dealScore: 94,
      offers: [],
    },
  ];

  const displayedResults = results.length ? results : demoResults;

  return (
    <main className="shell">
      <nav className="nav">
        <div className="logo">
          DEAL<span>AI</span>
        </div>

        <div className="navlinks">
          <a>Search</a>
          <a>AI Assistant</a>
          <a>Deals</a>
        </div>

        <button className="ghost">
          Sign in
        </button>
      </nav>

      <section className="hero">
        <div className="pill">
          AI-first shopping search
        </div>

        <h1>{heading}</h1>

        <p>
          Search products, compare real offers and let AI
          find the best value.
        </p>

        <div className="switcher">
          <button
            className={mode === 'search' ? 'active' : ''}
            onClick={() => setMode('search')}
            type="button"
          >
            🔎 Search
          </button>

          <button
            className={mode === 'assistant' ? 'active' : ''}
            onClick={() => setMode('assistant')}
            type="button"
          >
            ✨ AI Assistant
          </button>
        </div>

        <form onSubmit={submit} className="searchbar">
          <span>
            {mode === 'search' ? '🔎' : '✨'}
          </span>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === 'search'
                ? 'e.g. iPhone 17 256GB'
                : 'e.g. 55-inch OLED TV under €1200, 120Hz+'
            }
          />

          <button type="submit" disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        {searchStatus && (
          <div className="muted">
            {searchStatus}
          </div>
        )}

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        <div className="examples">
          <span>Try:</span>

          {[
            'iPhone 17 256GB',
            'OLED monitor 240Hz',
            '55 OLED TV under €1200',
          ].map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setQuery(x)}
            >
              {x}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="sectionhead">
          <h2>Browse categories</h2>
          <span>More coming</span>
        </div>

        <div className="categories">
          {categories.map((c) => (
            <button key={c} type="button">
              {c}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="sectionhead">
          <h2>
            {results.length ? 'Results' : 'Demo deals'}
          </h2>

          <span>
            {results.length
              ? `${results.length} matches · live data`
              : 'Demo sample data'}
          </span>
        </div>

        <div className="grid">
          {displayedResults.map((p) => {
            const image = p.image;
            const firstOffer = p.offers?.[0];
            const dealUrl =
              firstOffer?.url && firstOffer.url !== '#'
                ? firstOffer.url
                : '#';

            const icon =
              p.category === 'Phones'
                ? '📱'
                : p.category === 'Monitors'
                ? '🖥️'
                : p.category === 'TVs'
                ? '📺'
                : '🛍️';

            return (
              <article key={p.id} className="card">
                <div className="cardtop">
                  <span className="tag">
                    {p.category}
                  </span>

                  <span className="score">
                    {p.dealScore}/100
                  </span>
                </div>

                <div className="thumb">
                  {image ? (
                    <img
                      src={image}
                      alt={p.title}
                    />
                  ) : (
                    icon
                  )}
                </div>

                <h3>{p.title}</h3>

                <div className="price">
                  {formatPrice(
                    p.bestPrice,
                    p.currency
                  )}
                </div>

                <div className="muted">
                  Best current offer · deal score{' '}
                  {p.dealScore}
                </div>

                <a
                  className="view"
                  href={dealUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    if (dealUrl === '#') {
                      e.preventDefault();
                    }
                  }}
                >
                  {dealUrl === '#'
                    ? 'View offers'
                    : 'View deal'}
                </a>
              </article>
            );
          })}
        </div>
      </section>

      <footer>
        Built as an MVP: real merchant feeds,
        affiliate tracking, price history and AI
        ranking plug into this shell next.
      </footer>
    </main>
  );
}
