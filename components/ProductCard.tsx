'use client';

import Link from 'next/link';
import {
  useEffect,
  useState,
  type MouseEvent,
} from 'react';
import type { ProductResult } from '@/lib/types';

function money(value: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('lv-LV', {
      style: 'currency',
      currency,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export default function ProductCard({
  product,
}: {
  product: ProductResult;
  key?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [image, setImage] = useState(product.image || '');

  const storeCount =
    product.storesCount ||
    new Set(
      product.offers.map(
        (offer) => offer.merchantDomain || offer.merchant,
      ),
    ).size;

  useEffect(() => {
    setImage(product.image || '');

    if (
      product.image ||
      !product.id ||
      product.id.startsWith('family:')
    ) {
      return;
    }

    let active = true;

    fetch(
      `/api/products/${encodeURIComponent(product.id)}/image`,
    )
      .then((response) => response.json())
      .then((data) => {
        if (active && data.image) {
          setImage(data.image);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [product.id, product.image]);

  async function save(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!product.id || product.id.startsWith('family:')) {
      window.location.href = '/login';
      return;
    }

    setSaving(true);

    const response = await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id }),
    });

    if (response.status === 401) {
      window.location.href = '/login';
    } else if (response.ok) {
      setSaved(true);
    }

    setSaving(false);
  }

  return (
    <Link
      href={`/product/${encodeURIComponent(product.id)}`}
      className="productcard productcard-v21"
    >
      <button
        className={`heart ${saved ? 'saved' : ''}`}
        onClick={save}
        disabled={saving}
        aria-label="Saglabāt izlasē"
      >
        {saved ? '♥' : '♡'}
      </button>

      <div className="productimage">
        {image ? (
          <img
            src={image}
            alt={product.title}
            loading="lazy"
          />
        ) : (
          <div className="imagefallback imagefallback-soft">
            <span>C</span>
            <small>Bilde tiek meklēta</small>
          </div>
        )}
      </div>

      <div className="productbody">
        <div className="productmeta">
          <span>{product.brand || 'Produkts'}</span>
          <span>
            {storeCount} {storeCount === 1 ? 'veikals' : 'veikali'}
          </span>
        </div>

        <h3>{product.title}</h3>

        {!!product.variants?.length && (
          <div className="variantchips">
            {product.variants.slice(0, 3).map((variant) => (
              <span key={variant}>{variant}</span>
            ))}
            {product.variants.length > 3 && (
              <span>+{product.variants.length - 3}</span>
            )}
          </div>
        )}

        <div className="priceRow">
          <div>
            <small>no</small>
            <strong>
              {money(product.bestPrice, product.currency)}
            </strong>
          </div>

          {product.dealScore > 0 && storeCount >= 2 ? (
            <div className="score score-valid">
              <b>{product.dealScore}</b>
              <span>/100</span>
            </div>
          ) : (
            <div className="score score-pending">
              <b>—</b>
            </div>
          )}
        </div>

        <div className="scorelabel">
          {product.dealScore > 0 && storeCount >= 2
            ? 'CENIQ cenas vērtējums'
            : 'Vērtējums pēc vairāku veikalu salīdzināšanas'}
        </div>

        <div className="cardquick">
          <span>
            {storeCount >= 2
              ? `${storeCount} veikali salīdzināti`
              : 'Atver, lai CENIQ sameklē vēl veikalus'}
          </span>
          <b>Skatīt →</b>
        </div>
      </div>
    </Link>
  );
}
