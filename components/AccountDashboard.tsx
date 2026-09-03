'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type User = { id: string; email: string; name?: string | null };

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function AccountDashboard() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [wishlist, setWishlist] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [message, setMessage] = useState('');

  async function load() {
    const me = await fetch('/api/auth/me').then((r) => r.json());
    setUser(me.user || null);
    if (!me.user) return;
    const [w, a] = await Promise.all([fetch('/api/wishlist').then((r) => r.json()), fetch('/api/alerts').then((r) => r.json())]);
    setWishlist(w.items || []); setAlerts(a.alerts || []);
  }
  useEffect(() => { load(); }, []);

  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/'; }
  async function removeWishlist(productId: string) { await fetch(`/api/wishlist?productId=${encodeURIComponent(productId)}`, { method: 'DELETE' }); await load(); }
  async function removeAlert(id: string) { await fetch(`/api/alerts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); await load(); }

  async function enablePush() {
    setMessage('');
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error('Push paziņojumi vēl nav konfigurēti serverī.');
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Šī pārlūkprogramma neatbalsta push paziņojumus.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Paziņojumu atļauja netika piešķirta.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const response = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription) });
      if (!response.ok) throw new Error('Neizdevās saglabāt push paziņojumus.');
      setMessage('Pārlūka paziņojumi ieslēgti ✓');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Neizdevās ieslēgt paziņojumus.'); }
  }

  if (user === undefined) return <div className="container standalone"><div className="loaderline">Ielādē kontu…</div></div>;
  if (!user) return <div className="container standalone emptyState"><h1>Tavs Ceniq konts</h1><p>Ielogojies, lai redzētu izlasi un cenu brīdinājumus.</p><Link className="primary linkbtn" href="/login">Ielogoties</Link></div>;

  return <div className="container accountpage">
    <div className="accounthead"><div><span className="eyebrow">MANS CENIQ</span><h1>{user.name ? `Sveiks, ${user.name}.` : 'Tavs konts.'}</h1><p>{user.email}</p></div><div className="accountactions"><button className="secondary" onClick={enablePush}>🔔 Ieslēgt browser alerts</button><button className="secondary" onClick={logout}>Iziet</button></div></div>
    {message && <div className="notice">{message}</div>}
    <section className="accountsection"><div className="sectiontitle"><div><span>SAGLABĀTS</span><h2>Mana izlase</h2></div><p>{wishlist.length} produkti</p></div>{wishlist.length ? <div className="accountlist">{wishlist.map((item: any) => <div className="accountrow" key={item.id}><div className="tinyimage">{item.product.image ? <img src={item.product.image} alt=""/> : 'C'}</div><div className="grow"><b>{item.product.title}</b><span>{item.product.currentBestPrice ? `No €${item.product.currentBestPrice.toFixed(2)}` : 'Cena nav pieejama'}</span></div><Link className="smallcta" href={`/product/${item.productId}`}>Skatīt</Link><button className="textbtn" onClick={() => removeWishlist(item.productId)}>Noņemt</button></div>)}</div> : <div className="emptybox">Izlase vēl ir tukša. <Link href="/">Atrodi pirmo produktu →</Link></div>}</section>
    <section className="accountsection"><div className="sectiontitle"><div><span>SEKO CENAI</span><h2>Cenu brīdinājumi</h2></div><p>{alerts.filter((a: any) => a.active).length} aktīvi</p></div>{alerts.length ? <div className="accountlist">{alerts.map((a: any) => <div className="accountrow" key={a.id}><div className="grow"><b>{a.product.title}</b><span>Mērķis €{a.targetPrice.toFixed(2)} · pašlaik {a.product.currentBestPrice ? `€${a.product.currentBestPrice.toFixed(2)}` : '—'}</span></div><Link className="smallcta" href={`/product/${a.productId}`}>Skatīt</Link><button className="textbtn" onClick={() => removeAlert(a.id)}>Dzēst</button></div>)}</div> : <div className="emptybox">Nav aktīvu cenu brīdinājumu.</div>}</section>
  </div>;
}
