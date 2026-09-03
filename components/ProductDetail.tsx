'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import PriceChart from './PriceChart';

type Product = any;
const money = (v: number, c = 'EUR') => new Intl.NumberFormat('lv-LV', { style: 'currency', currency: c }).format(v);

export default function ProductDetail({ id }: { id: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [target, setTarget] = useState('');
  const [alertMsg, setAlertMsg] = useState('');

  async function load() {
    const r = await fetch(`/api/products/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) { setError(d.error || 'Produkts nav atrasts.'); return; }
    setProduct(d.product);
    if (!target && d.product.currentBestPrice) setTarget((d.product.currentBestPrice * .95).toFixed(2));
  }
  useEffect(() => { load(); }, [id]);

  const best = useMemo(() => product?.offers?.find((o: any) => o.isBestOverall) || product?.offers?.[0], [product]);

  async function refresh() {
    setRefreshing(true); setError('');
    try {
      const s = await fetch(`/api/products/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
      const sd = await s.json();
      if (!s.ok) throw new Error(sd.error || 'Neizdevās atjaunot cenas.');
      for (let i = 0; i < 35; i += 1) {
        await new Promise((r) => setTimeout(r, 1600));
        const p = await fetch(`/api/products/${encodeURIComponent(id)}/refresh?taskId=${encodeURIComponent(sd.taskId)}`);
        const pd = await p.json();
        if (!p.ok) throw new Error(pd.error || 'Neizdevās atjaunot cenas.');
        if (pd.pending) continue;
        await load(); return;
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Neizdevās atjaunot.'); }
    finally { setRefreshing(false); }
  }

  async function wishlist() {
    const r = await fetch('/api/wishlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: id }) });
    if (r.status === 401) { window.location.href = '/login'; return; }
    if (r.ok) setSaved(true);
  }

  async function createAlert() {
    setAlertMsg('');
    const r = await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: id, targetPrice: Number(target), emailEnabled: true, browserEnabled: true }) });
    const d = await r.json();
    if (r.status === 401) { window.location.href = '/login'; return; }
    setAlertMsg(r.ok ? 'Brīdinājums izveidots ✓' : d.error || 'Neizdevās izveidot brīdinājumu.');
  }

  if (error && !product) return <div className="container standalone"><div className="errorbox">{error}</div></div>;
  if (!product) return <div className="container standalone"><div className="loaderline">Ielādē produktu…</div></div>;

  return <div className="container productpage">
    <a className="backlink" href="/">← Atpakaļ uz meklēšanu</a>
    <section className="producthero">
      <div className="detailimage">{product.image ? <img src={product.image} alt=""/> : <div className="imagefallback">C</div>}</div>
      <div className="detailcopy"><div className="eyebrow">{product.brand || 'Ceniq atrasts produkts'}</div><h1>{product.title}</h1><div className="detailscore"><div><span>Labākā cena</span><strong>{product.currentBestPrice ? money(product.currentBestPrice, product.currency) : '—'}</strong></div><div className="score big"><b>{product.dealScore}</b><span>/100</span></div></div><p className="muted">Ceniq vērtējums apvieno kopējo cenu, piegādes un tirgotāja uzticamības signālus.</p><div className="detailactions"><button className="primary" onClick={wishlist}>{saved ? '♥ Saglabāts' : '♡ Saglabāt izlasē'}</button><button className="secondary" onClick={refresh} disabled={refreshing}>{refreshing ? 'Atjauno…' : '↻ Atjaunot cenas'}</button></div>{best && <div className="recommend"><span>🏆 Ceniq izvēle</span><b>{best.merchant}</b><p>{money(best.totalPrice, best.currency)} kopā {best.deliveryMessage ? `· ${best.deliveryMessage}` : ''}</p></div>}</div>
    </section>

    {error && <div className="errorbox">{error}</div>}
    <section className="detailsection"><div className="sectiontitle"><div><span>SALĪDZINI</span><h2>Veikalu piedāvājumi</h2></div><p>{product.offers.length} piedāvājumi</p></div><div className="offertable">{product.offers.map((o: any) => <div className={`offerrow ${o.isBestOverall ? 'best' : ''}`} key={o.id}><div><b>{o.merchant}</b><span>{o.isBestOverall ? '🏆 Labākā izvēle' : o.isCheapest ? '💰 Lētākais' : o.deliveryMessage || 'Piedāvājums'}</span></div><div><span>Prece</span><b>{money(o.price, o.currency)}</b></div><div><span>Piegāde</span><b>{o.shipping ? money(o.shipping, o.currency) : '€0 / nav norādīta'}</b></div><div><span>Kopā</span><strong>{money(o.totalPrice, o.currency)}</strong></div><a className="offercta" href={`/api/out?offerId=${encodeURIComponent(o.id)}`} target="_blank" rel="nofollow sponsored noopener">Uz veikalu ↗</a></div>)}</div></section>

    <section className="twocol"><div className="detailsection"><div className="sectiontitle"><div><span>VĒSTURE</span><h2>Cenas dinamika</h2></div></div><PriceChart points={product.snapshots} currency={product.currency}/></div><div className="detailsection alertbox"><span className="eyebrow">CENU BRĪDINĀJUMS</span><h2>Pasaki savu cenu.</h2><p>Mēs pārbaudīsim cenu un paziņosim, kad tā sasniegs tavu slieksni.</p><label>Mērķa cena (€)<input type="number" min="1" step="0.01" value={target} onChange={(e: ChangeEvent<HTMLInputElement>) => setTarget(e.target.value)}/></label><button className="primary" onClick={createAlert}>🔔 Izveidot brīdinājumu</button>{alertMsg && <small>{alertMsg}</small>}</div></section>
  </div>;
}
