'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { CatalogVariantView, OfferView, ProductResult, VariantAttributes } from '@/lib/types';

const AXIS_ORDER: Array<keyof VariantAttributes> = [
  'storage',
  'color',
  'ram',
  'connectivity',
  'size',
  'cpu',
  'gpu',
  'resolution',
  'panelType',
  'refreshRate',
  'kit',
  'condition',
];

const AXIS_LABELS: Partial<Record<keyof VariantAttributes, string>> = {
  storage: 'Atmiņa',
  color: 'Krāsa',
  ram: 'RAM',
  connectivity: 'Savienojums',
  size: 'Izmērs',
  cpu: 'Procesors',
  gpu: 'Grafika',
  resolution: 'Izšķirtspēja',
  panelType: 'Panelis',
  refreshRate: 'Frekvence',
  kit: 'Komplekts',
  condition: 'Stāvoklis',
};

function money(value: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('lv-LV', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function merchantKey(offer: OfferView) {
  return String(offer.merchantDomain || offer.merchant || '').toLowerCase().replace(/^www\./, '');
}

function cleanAttributes(attributes: VariantAttributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => Boolean(value) && value !== 'New'),
  ) as VariantAttributes;
}

function sameSelection(attributes: VariantAttributes, selected: Partial<VariantAttributes>) {
  return Object.entries(selected).every(
    ([key, value]) => !value || attributes[key as keyof VariantAttributes] === value,
  );
}

function variantOptions(variants: CatalogVariantView[]) {
  const result: Partial<Record<keyof VariantAttributes, string[]>> = {};

  for (const axis of AXIS_ORDER) {
    const values = Array.from(
      new Set(
        variants
          .filter((variant) => variant.offerCount > 0)
          .map((variant) => variant.attributes?.[axis])
          .filter((value): value is string => Boolean(value) && !(axis === 'condition' && value === 'New')),
      ),
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (values.length > 1) result[axis] = values;
  }

  return result;
}

function queryChoice(query: string, values: string[]) {
  const normalized = query.toLowerCase().replace(/\s+/g, '');
  return values.find((value) => normalized.includes(value.toLowerCase().replace(/\s+/g, '')));
}

function selectedScore(offers: OfferView[]) {
  if (new Set(offers.map(merchantKey)).size < 2) return 0;
  return Math.max(0, ...offers.map((offer) => Number(offer.dealScore || 0)));
}

function availability(offer: OfferView) {
  return offer.deliveryMessage || 'Pārbaudīt veikalā';
}

function chooseBestVariant(
  variants: CatalogVariantView[],
  current: Partial<VariantAttributes>,
  axis: keyof VariantAttributes,
  value: string,
) {
  const candidates = variants.filter(
    (variant) => variant.offerCount > 0 && variant.attributes?.[axis] === value,
  );
  if (!candidates.length) return null;

  const otherAxes = Object.entries(current).filter(([key, selected]) => key !== axis && Boolean(selected));
  return [...candidates].sort((a, b) => {
    const matchesA = otherAxes.filter(([key, selected]) => a.attributes[key as keyof VariantAttributes] === selected).length;
    const matchesB = otherAxes.filter(([key, selected]) => b.attributes[key as keyof VariantAttributes] === selected).length;
    return (
      matchesB - matchesA ||
      b.offerCount - a.offerCount ||
      (a.bestPrice ?? Number.MAX_SAFE_INTEGER) - (b.bestPrice ?? Number.MAX_SAFE_INTEGER)
    );
  })[0];
}

export default function ProductCard({ product, query = '' }: { product: ProductResult; query?: string; key?: string }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Partial<VariantAttributes>>({});

  const catalogVariants = useMemo(
    () => (product.catalogVariants || []).filter((variant) => variant.offerCount > 0),
    [product.catalogVariants],
  );

  const axes = useMemo(() => variantOptions(catalogVariants), [catalogVariants]);

  const cheapestOffer = useMemo(
    () => [...(product.offers || [])].sort((a, b) => a.totalPrice - b.totalPrice)[0],
    [product.offers],
  );

  useEffect(() => {
    const explicit = catalogVariants.find((variant) => variant.id === product.selectedVariantId);
    const cheapestVariant = cheapestOffer?.variantId
      ? catalogVariants.find((variant) => variant.id === cheapestOffer.variantId)
      : undefined;
    const fallback = explicit || cheapestVariant || catalogVariants[0];

    if (!fallback) {
      setSelected({});
      return;
    }

    const next = { ...fallback.attributes } as Partial<VariantAttributes>;
    for (const axis of AXIS_ORDER) {
      const values = axes[axis];
      if (!values?.length) continue;
      const fromQuery = queryChoice(query, values);
      if (!fromQuery) continue;
      const candidate = chooseBestVariant(catalogVariants, next, axis, fromQuery);
      if (candidate) Object.assign(next, candidate.attributes);
    }

    setSelected(next);
    setShowAll(false);
  }, [product.id, product.selectedVariantId, catalogVariants, cheapestOffer?.variantId, axes, query]);

  const selectedCatalogVariant = useMemo(() => {
    const exact = catalogVariants.find((variant) => sameSelection(variant.attributes, selected));
    if (exact) return exact;

    return [...catalogVariants].sort((a, b) => {
      const matchesA = Object.entries(selected).filter(([key, value]) => value && a.attributes[key as keyof VariantAttributes] === value).length;
      const matchesB = Object.entries(selected).filter(([key, value]) => value && b.attributes[key as keyof VariantAttributes] === value).length;
      return matchesB - matchesA || b.offerCount - a.offerCount;
    })[0];
  }, [catalogVariants, selected]);

  const selectedOffers = useMemo(() => {
    const matching = selectedCatalogVariant
      ? product.offers.filter((offer) => offer.variantId === selectedCatalogVariant.id)
      : product.offers.filter((offer) => sameSelection(offer.variantData || {}, selected));

    return [...matching].sort((a, b) => {
      if (a.isBestOverall !== b.isBestOverall) return a.isBestOverall ? -1 : 1;
      return a.totalPrice - b.totalPrice;
    });
  }, [product.offers, selectedCatalogVariant, selected]);

  const stores = new Set(selectedOffers.map(merchantKey)).size;
  const score = selectedScore(selectedOffers);
  const selectedBest = selectedOffers[0];

  const currentImage =
    selectedCatalogVariant?.image ||
    selectedOffers.find((offer) => Boolean(offer.image))?.image ||
    product.familyImage ||
    product.image ||
    '';

  const productHref = `/product/${encodeURIComponent(product.id)}${
    selectedCatalogVariant?.id ? `?variantId=${encodeURIComponent(selectedCatalogVariant.id)}` : ''
  }`;

  const visibleOffers = showAll ? selectedOffers : selectedOffers.slice(0, 3);

  function chooseVariant(axis: keyof VariantAttributes, value: string) {
    const candidate = chooseBestVariant(catalogVariants, selected, axis, value);
    if (!candidate) return;
    setSelected(candidate.attributes);
    setShowAll(false);
  }

  function offerHref(offer: OfferView) {
    if (offer.id) return `/api/out?offerId=${encodeURIComponent(offer.id)}`;
    return offer.url || productHref;
  }

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
      body: JSON.stringify({ familyId: product.id, variantId: selectedCatalogVariant?.id }),
    });

    if (response.status === 401) window.location.href = '/login';
    else if (response.ok) setSaved(true);
    setSaving(false);
  }

  return (
    <article className="resultfamily">
      <div className="resultfamily-main">
        <div className="resultfamily-image">
          {currentImage ? (
            <img src={currentImage} alt={product.title} loading="lazy" />
          ) : (
            <div className="imagefallback imagefallback-soft">
              <span>C</span>
              <small>Bilde nav pieejama</small>
            </div>
          )}
        </div>

        <div className="resultfamily-info">
          <div className="productmeta">
            <span>{product.brand || 'Produkts'}</span>
            <span>
              {stores} {stores === 1 ? 'veikals' : 'veikali'} šim variantam
            </span>
          </div>

          <Link href={productHref} className="resultfamily-title">
            {product.title}
          </Link>

          {AXIS_ORDER.some((axis) => Boolean(axes[axis]?.length)) && (
            <div className="resultvariants">
              {AXIS_ORDER.map((axis) => {
                const options = axes[axis];
                if (!options || options.length < 2) return null;

                return (
                  <div className="resultvariant-axis" key={axis}>
                    <small>{AXIS_LABELS[axis]}</small>
                    <div>
                      {options.map((option) => (
                        <button
                          type="button"
                          key={option}
                          className={selected[axis] === option ? 'active' : ''}
                          onClick={() => chooseVariant(axis, option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="resultfamily-price">
            <div>
              <small>Labākā cena</small>
              <strong>{selectedBest ? money(selectedBest.totalPrice, selectedBest.currency) : '—'}</strong>
            </div>
            <div className="resultfamily-score">
              <small>CENIQ score</small>
              <strong>{score > 0 ? `${score}/100` : 'Vēl nav'}</strong>
            </div>
          </div>

          <div className="resultfamily-actions">
            <Link href={productHref}>Pilna analīze →</Link>
            <button type="button" className="heart resultheart" onClick={save} disabled={saving}>
              {saved ? '♥ Saglabāts' : '♡ Saglabāt'}
            </button>
          </div>
        </div>
      </div>

      <div className="inlineoffers">
        <div className="inlineoffers-head">
          <div>
            <small>VEIKALU PIEDĀVĀJUMI</small>
            <b>Top {Math.min(3, selectedOffers.length)}</b>
          </div>
          <span>
            {selectedOffers.length} {selectedOffers.length === 1 ? 'piedāvājums' : 'piedāvājumi'}
          </span>
        </div>

        {visibleOffers.length ? (
          <div className="inlineoffer-list">
            {visibleOffers.map((offer, index) => (
              <div className="inlineoffer" key={offer.id || `${merchantKey(offer)}-${offer.totalPrice}-${index}`}>
                <div className="inlineoffer-rank">{String(index + 1).padStart(2, '0')}</div>
                <div className="inlineoffer-store">
                  <b>{offer.merchant}</b>
                  <small>{availability(offer)}</small>
                </div>
                <div className="inlineoffer-price">
                  <b>{money(offer.totalPrice, offer.currency)}</b>
                  {offer.dealScore > 0 && stores >= 2 && <small>{offer.dealScore}/100</small>}
                </div>
                <a
                  href={offerHref(offer)}
                  target="_blank"
                  rel="nofollow sponsored noopener"
                  className="inlineoffer-go"
                >
                  Uz veikalu ↗
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="filterempty">Šim variantam piedāvājumi vēl nav atrasti.</div>
        )}

        {selectedOffers.length > 3 && (
          <button type="button" className="showalloffers" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Rādīt tikai Top 3' : `Rādīt visus ${selectedOffers.length} piedāvājumus`}
          </button>
        )}
      </div>
    </article>
  );
}
