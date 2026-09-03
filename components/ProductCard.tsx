'use client';

import Link from 'next/link';
import type { OfferView, ProductResult } from '@/lib/types';
import { useState } from 'react';

function money(value: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('lv-LV', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function shippingText(offer?: OfferView) {
  if (!offer) return 'Nav datu';
  if (offer.shipping > 0) return money(offer.shipping, offer.currency);
  if (/free|bezmaksas/i.test(offer.deliveryMessage || '')) return 'Bezmaksas';
  if (offer.deliveryMessage) return offer.deliveryMessage;
  return 'Nav datu';
}

function confidence(product: ProductResult) {
  const signalCount = product.offers.filter(
    (offer) => offer.sellerRating || offer.shipping > 0 || offer.deliveryMessage,
  ).length;

  if (product.offers.length >= 3 && signalCount >= 2) return 'augsta';
  if (product.offers.length >= 2 || signalCount >= 1) return 'vidēja';
  return 'zema';
}

export default function ProductCard({ product }: { product: ProductResult; key?: string }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const hasComparison = product.offers.length > 1;
  const best =
    product.offers.find((offer) => offer.isBestOverall) ||
    product.offers.find((offer) => offer.isCheapest) ||
    product.offers[0];

  async function save(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (
      !product.id ||
      product.id.startsWith('pid:') ||
      product.id.startsWith('gid:') ||
      product.id.startsWith('title:')
    ) {
      window.location.href = '/login';
      return;
    }

    setSaving(true);

    const response = await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id }),
    });

    if (response.status === 401) window.location.href = '/login';
    else if (response.ok) setSaved(true);

    setSaving(false);
  }

  const href = `/product/${encodeURIComponent(product.id)}`;

  return (
    <Link href={href} className="productcard">
      <button
        className={`heart ${saved ? 'saved' : ''}`}
        onClick={save}
        disabled={saving}
        aria-label="Saglabāt izlasē"
      >
        {saved ? '♥' : '♡'}
      </button>

      <div className="productimage">
        {product.image ? (
          <img src={product.image} alt="" loading="lazy" />
        ) : (
          <div className="imagefallback">C</div>
        )}
      </div>

      <div className="productbody">
        <div className="productmeta">
          <span>{product.brand || 'Produkts'}</span>
          <span>{product.offers.length || product.storesCount || 1} piedāv.</span>
        </div>

        <h3>{product.title}</h3>

        <div className="priceRow">
          <div>
            <small>no</small>
            <strong>{money(product.bestPrice, product.currency)}</strong>
          </div>

          <div
            className="score"
            title={`CENIQ datu pārliecība: ${confidence(product)}`}
          >
            <b>{product.dealScore}</b>
            <span>/100</span>
          </div>
        </div>

        <div className="scorelabel">
          CENIQ piedāvājuma vērtējums · {confidence(product)} pārliecība
        </div>

        <div className="cardexpand">
          <div>
            <span>{hasComparison ? 'CENIQ izvēle' : 'Atrasts veikals'}</span>
            <b>{best?.merchant || 'Veikals nav zināms'}</b>
          </div>

          <div>
            <span>Piegāde</span>
            <b>{shippingText(best)}</b>
          </div>

          <div>
            <span>Kopā</span>
            <b>
              {best
                ? money(best.totalPrice, best.currency)
                : money(product.bestPrice, product.currency)}
            </b>
          </div>

          <span className="comparecta">
            {hasComparison ? 'Salīdzināt piedāvājumus →' : 'Skatīt piedāvājumu →'}
          </span>
        </div>
      </div>
    </Link>
  );
}
