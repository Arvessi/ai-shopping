'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Me = { id: string; email: string; name?: string | null } | null;

export default function Header() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [user, setUser] = useState<Me>(null);

  useEffect(() => {
    const saved = localStorage.getItem('ceniq-theme') as 'light' | 'dark' | null;
    const initial = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
    fetch('/api/auth/me').then((r) => r.json()).then((d) => setUser(d.user || null)).catch(() => undefined);
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ceniq-theme', next);
  }

  return (
    <header className="topbar">
      <div className="container navrow">
        <Link className="wordmark" href="/">ceniq<span>.</span></Link>
        <nav className="navlinks" aria-label="Galvenā navigācija">
          <Link href="/#meklet">Meklēt</Link>
          <Link href="/#meklet">AI asistents</Link>
          <Link href="/#populari">Populārie</Link>
          <Link href="/account">Mana izlase</Link>
        </nav>
        <div className="navactions">
          <button className="iconbtn" onClick={toggleTheme} aria-label="Mainīt krāsu režīmu">{theme === 'dark' ? '☀' : '◐'}</button>
          <Link className="navaccount" href={user ? '/account' : '/login'}>{user ? (user.name || 'Konts') : 'Ielogoties'}</Link>
        </div>
      </div>
    </header>
  );
}
