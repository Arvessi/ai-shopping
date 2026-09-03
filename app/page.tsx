'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { ProductResult } from '../lib/types';

const categories = ['Electronics', 'Phones', 'Laptops', 'Monitors', 'TVs', 'Audio', 'Gaming', 'Home'];

export default function Home() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'search' | 'assistant'>('search');
  const [results, setResults] = useState<ProductResult[]>([]);
  const [loading, setLoading] = useState(false);

  const heading = useMemo(
    () => mode === 'search' ? 'Find exactly what you want.' : 'Tell AI what you need.',
    [mode]
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.results ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <nav className="nav">
        <div className="logo">DEAL<span>AI</span></div>
        <div className="navlinks"><a>Search</a><a>AI Assistant</a><a>Deals</a></div>
        <button className="ghost">Sign in</button>
      </nav>

      <section className="hero">
        <div className="pill">AI-first shopping search</div>
        <h1>{heading}</h1>
        <p>Search products, compare real offers and let AI find the best value.</p>

        <div className="switcher">
          <button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>🔎 Search</button>
          <button className={mode === 'assistant' ? 'active' : ''} onClick={() => setMode('assistant')}>✨ AI Assistant</button>
        </div>

        <form onSubmit={submit} className="searchbar">
          <span>{mode === 'search' ? '🔎' : '✨'}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'search' ? 'e.g. iPhone 17 256GB' : 'e.g. 55-inch OLED TV under €1200, 120Hz+'}
          />
          <button type="submit">{loading ? 'Searching…' : 'Search'}</button>
        </form>

        <div className="examples">
          <span>Try:</span>
          {['iPhone 17 256GB', 'OLED monitor 240Hz', '55 OLED TV under €1200'].map((x) => (
            <button key={x} onClick={() => setQuery(x)}>{x}</button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="sectionhead"><h2>Browse categories</h2><span>More coming</span></div>
        <div className="categories">
          {categories.map((c) => <button key={c}>{c}</button>)}
        </div>
      </section>

      <section className="section">
        <div className="sectionhead"><h2>{results.length ? 'Results' : 'Demo deals'}</h2><span>{results.length ? `${results.length} matches` : 'MVP sample data'}</span></div>
        <div className="grid">
          {(results.length ? results : [
            { id: 'demo1', title: 'Apple iPhone 17 256GB', brand: 'Apple', category: 'Phones', bestPrice: 899, currency: 'EUR', dealScore: 91, offers: [] },
            { id: 'demo2', title: '27" QHD 240Hz OLED Gaming Monitor', brand: 'DemoBrand', category: 'Monitors', bestPrice: 549, currency: 'EUR', dealScore: 88, offers: [] },
            { id: 'demo3', title: '55" 4K OLED 120Hz Smart TV', brand: 'DemoVision', category: 'TVs', bestPrice: 999, currency: 'EUR', dealScore: 94, offers: [] }
          ] as ProductResult[]).map((p) => (
            <article key={p.id} className="card">
              <div className="cardtop"><span className="tag">{p.category}</span><span className="score">{p.dealScore}/100</span></div>
              <div className="thumb">{p.category === 'Phones' ? '📱' : p.category === 'Monitors' ? '🖥️' : '📺'}</div>
              <h3>{p.title}</h3>
              <div className="price">€{p.bestPrice.toFixed(0)}</div>
              <div className="muted">Best current offer · deal score {p.dealScore}</div>
              <button className="view">View offers</button>
            </article>
          ))}
        </div>
      </section>

      <footer>Built as an MVP: real merchant feeds, affiliate tracking, price history and AI ranking plug into this shell next.</footer>
    </main>
  );
}
