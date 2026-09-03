'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';

export default function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setError('');
    const fd = new FormData(e.currentTarget);
    const payload = { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') };
    const r = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) setError(d.error || 'Neizdevās.'); else window.location.href = '/account';
    setLoading(false);
  }
  return <div className="authshell"><div className="authcard"><div className="wordmark authlogo">ceniq<span>.</span></div><h1>{mode === 'login' ? 'Laipni atpakaļ.' : 'Izveido Ceniq kontu.'}</h1><p>{mode === 'login' ? 'Tava izlase un cenu brīdinājumi gaida.' : 'Saglabā produktus un saņem cenu brīdinājumus.'}</p><form onSubmit={submit}>{mode === 'register' && <label>Vārds<input name="name" autoComplete="name" placeholder="Tavs vārds"/></label>}<label>E-pasts<input name="email" type="email" autoComplete="email" required placeholder="tu@epasts.lv"/></label><label>Parole<input name="password" type="password" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required placeholder="Vismaz 8 rakstzīmes"/></label>{error && <div className="errorbox">{error}</div>}<button className="primary wide" disabled={loading}>{loading ? 'Apstrādā…' : mode === 'login' ? 'Ielogoties' : 'Reģistrēties'}</button></form><small>{mode === 'login' ? <>Nav konta? <Link href="/register">Reģistrēties</Link></> : <>Jau ir konts? <Link href="/login">Ielogoties</Link></>}</small></div></div>;
}
