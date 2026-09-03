'use client';

import Link from 'next/link';
import type { ProductResult } from '@/lib/types';
import { useState } from 'react';

function money(value: number, currency = 'EUR') {
  try { return new Intl.NumberFormat('lv-LV', { style: 'currency', currency }).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
}

export default function ProductCard({ product }: { product: ProductResult; key?: string }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const best = product.offers.find((o) => o.isBestOverall) || product.offers[0];

  async function save(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!product.id || product.id.startsWith('pid:') || product.id.startsWith('gid:') || product.id.startsWith('title:')) { window.location.href = '/login'; return; }
    setSaving(true);
    const response = await fetch('/api/wishlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: product.id }) });
    if (response.status === 401) window.location.href = '/login';
    else if (response.ok) setSaved(true);
    setSaving(false);
  }

  const href = `/product/${encodeURIComponent(product.id)}`;
  return (
    <Link href={href} className="productcard">
      <button className={`heart ${saved ? 'saved' : ''}`} onClick={save} disabled={saving} aria-label="Saglabāt izlasē">{saved ? '♥' : '♡'}</button>
      <div className="productimage">
        {product.image ? <img src={product.image} alt="" loading="lazy" /> : <div className="imagefallback">C</div>}
      </div>
      <div className="productbody">
        <div className="productmeta"><span>{product.brand || 'Produkts'}</span><span>{product.offers.length || product.storesCount || 1} piedāv.</span></div>
        <h3>{product.title}</h3>
        <div className="priceRow"><div><small>no</small><strong>{money(product.bestPrice, product.currency)}</strong></div><div className="score"><b>{product.dealScore}</b><span>/100</span></div></div>
        <div className="scorelabel">Ceniq vērtējums</div>
        <div className="cardexpand">
          <div><span>Labākā izvēle</span><b>{best?.merchant || 'Salīdzināt veikalus'}</b></div>
          <div><span>Piegāde</span><b>{best?.shipping ? money(best.shipping, best.currency) : 'Bezmaksas / nav norādīta'}</b></div>
          <div><span>Kopā</span><b>{best ? money(best.totalPrice, best.currency) : money(product.bestPrice, product.currency)}</b></div>
          <span className="comparecta">Salīdzināt piedāvājumus →</span>
        </div>
      </div>
    </Link>
  );
}
