'use client';

import Link from 'next/link';
import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from 'react';
import type {
  OfferView,
  ProductResult,
  VariantAttributes,
} from '@/lib/types';

const AXIS_ORDER: Array<
  keyof VariantAttributes
> = [
  'storage',
  'color',
  'ram',
  'connectivity',
  'size',
  'condition',
];

const AXIS_LABELS: Record<
  keyof VariantAttributes,
  string
> = {
  storage: 'Atmiņa',
  color: 'Krāsa',
  ram: 'RAM',
  connectivity: 'Savienojums',
  size: 'Izmērs',
  condition: 'Stāvoklis',
};

function money(
  value: number,
  currency = 'EUR',
) {
  try {
    return new Intl.NumberFormat(
      'lv-LV',
      {
        style: 'currency',
        currency,
      },
    ).format(value);
  } catch {
    return `${value.toFixed(
      2,
    )} ${currency}`;
  }
}

function merchantKey(
  offer: OfferView,
) {
  return (
    offer.merchantDomain ||
    offer.merchant
  )
    .toLowerCase()
    .replace(/^www\./, '');
}

function matchesVariant(
  offer: OfferView,
  selected: Partial<
    VariantAttributes
  >,
) {
  return Object.entries(
    selected,
  ).every(
    ([key, value]) =>
      !value ||
      offer.variantData?.[
        key as keyof VariantAttributes
      ] === value,
  );
}

function variantOptions(
  offers: OfferView[],
) {
  const result: Partial<
    Record<
      keyof VariantAttributes,
      string[]
    >
  > = {};

  for (const axis of AXIS_ORDER) {
    const values = Array.from(
      new Set(
        offers
          .map(
            (offer) =>
              offer.variantData?.[
                axis
              ],
          )
          .filter(
            (value) =>
              Boolean(value) &&
              !(
                axis ===
                  'condition' &&
                value === 'New'
              ),
          ) as string[],
      ),
    );

    if (values.length > 1) {
      result[axis] =
        values.sort();
    }
  }

  return result;
}

function selectedScore(
  offers: OfferView[],
) {
  const stores =
    new Set(
      offers.map(
        merchantKey,
      ),
    ).size;

  if (stores < 2) return 0;

  return Math.max(
    0,
    ...offers.map(
      (offer) =>
        offer.dealScore ||
        0,
    ),
  );
}

function availability(
  offer: OfferView,
) {
  if (
    offer.deliveryMessage
  ) {
    return offer.deliveryMessage;
  }

  return 'Pārbaudīt veikalā';
}

function normalizedVariantText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/gb/g, 'gb')
    .trim();
}

function queryVariantChoice(
  query: string,
  options: string[],
) {
  const normalizedQuery = normalizedVariantText(query);

  return options.find((option) => {
    const normalizedOption = normalizedVariantText(option);
    return normalizedOption && normalizedQuery.includes(normalizedOption);
  });
}

export default function ProductCard({
  product,
  query = '',
}: {
  product: ProductResult;
  query?: string;
  key?: string;
}) {
  const [saving, setSaving] =
    useState(false);
  const [saved, setSaved] =
    useState(false);
  const [showAll, setShowAll] =
    useState(false);

  const axes = useMemo(
    () =>
      variantOptions(
        product.offers,
      ),
    [product.offers],
  );

  const cheapest = useMemo(
    () =>
      [...product.offers].sort(
        (a, b) =>
          a.totalPrice -
          b.totalPrice,
      )[0],
    [product.offers],
  );

  const [selected, setSelected] =
    useState<
      Partial<VariantAttributes>
    >({});

  useEffect(() => {
    const defaults: Partial<
      VariantAttributes
    > = {};

    for (const axis of AXIS_ORDER) {
      const options =
        axes[axis];

      if (
        !options ||
        options.length < 2
      ) {
        continue;
      }

      defaults[axis] =
        queryVariantChoice(
          query,
          options,
        ) ||
        cheapest?.variantData?.[
          axis
        ] ||
        options[0];
    }

    setSelected(defaults);
    setShowAll(false);
  }, [
    product.id,
    query,
    axes,
    cheapest,
  ]);

  const selectedOffers =
    useMemo(() => {
      let offers =
        product.offers.filter(
          (offer: OfferView) =>
            matchesVariant(
              offer,
              selected,
            ),
        );

      return [
        ...offers,
      ].sort((a, b) => {
        if (
          a.isBestOverall !==
          b.isBestOverall
        ) {
          return a.isBestOverall
            ? -1
            : 1;
        }

        return (
          a.totalPrice -
          b.totalPrice
        );
      });
    }, [
      product.offers,
      selected,
    ]);

  const stores =
    new Set(
      selectedOffers.map(
        merchantKey,
      ),
    ).size;

  const score =
    selectedScore(
      selectedOffers,
    );

  const selectedBest =
    selectedOffers[0] ||
    cheapest;

  const currentImage =
    selectedOffers.find(
      (offer: OfferView) =>
        Boolean(
          offer.image,
        ),
    )?.image ||
    product.image ||
    '';

  const visibleOffers =
    showAll
      ? selectedOffers
      : selectedOffers.slice(
          0,
          3,
        );

  function chooseVariant(
    axis: keyof VariantAttributes,
    value: string,
  ) {
    setSelected(
      (current: Partial<VariantAttributes>) => ({
        ...current,
        [axis]: value,
      }),
    );

    setShowAll(false);
  }

  function offerHref(
    offer: OfferView,
  ) {
    if (offer.id) {
      return `/api/out?offerId=${encodeURIComponent(
        offer.id,
      )}`;
    }

    return (
      offer.url ||
      `/product/${encodeURIComponent(
        product.id,
      )}`
    );
  }

  async function save(
    e: MouseEvent,
  ) {
    e.preventDefault();
    e.stopPropagation();

    if (
      !product.id ||
      product.id.startsWith(
        'family:',
      )
    ) {
      window.location.href =
        '/login';
      return;
    }

    setSaving(true);

    const response =
      await fetch(
        '/api/wishlist',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            productId:
              product.id,
          }),
        },
      );

    if (
      response.status ===
      401
    ) {
      window.location.href =
        '/login';
    } else if (
      response.ok
    ) {
      setSaved(true);
    }

    setSaving(false);
  }

  return (
    <article className="resultfamily">
      <div className="resultfamily-main">
        <div className="resultfamily-image">
          {currentImage ? (
            <img
              src={currentImage}
              alt={
                product.title
              }
              loading="lazy"
            />
          ) : (
            <div className="imagefallback imagefallback-soft">
              <span>C</span>
              <small>
                Bilde nav
                pieejama
              </small>
            </div>
          )}
        </div>

        <div className="resultfamily-info">
          <div className="productmeta">
            <span>
              {product.brand ||
                'Produkts'}
            </span>

            <span>
              {stores}{' '}
              {stores === 1
                ? 'veikals'
                : 'veikali'}{' '}
              šim variantam
            </span>
          </div>

          <Link
            href={`/product/${encodeURIComponent(
              product.id,
            )}`}
            className="resultfamily-title"
          >
            {product.title}
          </Link>

          {AXIS_ORDER.some(
            (axis) =>
              Boolean(
                axes[axis],
              ),
          ) && (
            <div className="resultvariants">
              {AXIS_ORDER.map(
                (axis) => {
                  const options =
                    axes[axis];

                  if (
                    !options ||
                    options.length <
                      2
                  ) {
                    return null;
                  }

                  return (
                    <div
                      className="resultvariant-axis"
                      key={axis}
                    >
                      <small>
                        {
                          AXIS_LABELS[
                            axis
                          ]
                        }
                      </small>

                      <div>
                        {options.map(
                          (
                            option: string,
                          ) => (
                            <button
                              type="button"
                              key={
                                option
                              }
                              className={
                                selected[
                                  axis
                                ] ===
                                option
                                  ? 'active'
                                  : ''
                              }
                              onClick={() =>
                                chooseVariant(
                                  axis,
                                  option,
                                )
                              }
                            >
                              {
                                option
                              }
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}

          <div className="resultfamily-price">
            <div>
              <small>
                Labākā cena
              </small>

              <strong>
                {selectedBest
                  ? money(
                      selectedBest.totalPrice,
                      selectedBest.currency,
                    )
                  : '—'}
              </strong>
            </div>

            <div className="resultfamily-score">
              <small>
                CENIQ score
              </small>

              <strong>
                {score > 0
                  ? `${score}/100`
                  : 'Vēl nav'}
              </strong>
            </div>
          </div>

          <div className="resultfamily-actions">
            <Link
              href={`/product/${encodeURIComponent(
                product.id,
              )}`}
            >
              Pilna analīze →
            </Link>

            <button
              type="button"
              className="heart resultheart"
              onClick={save}
              disabled={
                saving
              }
            >
              {saved
                ? '♥ Saglabāts'
                : '♡ Saglabāt'}
            </button>
          </div>
        </div>
      </div>

      <div className="inlineoffers">
        <div className="inlineoffers-head">
          <div>
            <small>
              VEIKALU
              PIEDĀVĀJUMI
            </small>

            <b>
              Top{' '}
              {Math.min(
                3,
                selectedOffers.length,
              )}
            </b>
          </div>

          <span>
            {
              selectedOffers.length
            }{' '}
            {selectedOffers.length ===
            1
              ? 'piedāvājums'
              : 'piedāvājumi'}
          </span>
        </div>

        {visibleOffers.length ? (
          <div className="inlineoffer-list">
            {visibleOffers.map(
              (
                offer: OfferView,
                index: number,
              ) => (
                <div
                  className="inlineoffer"
                  key={
                    offer.id ||
                    `${merchantKey(
                      offer,
                    )}-${offer.totalPrice}-${index}`
                  }
                >
                  <div className="inlineoffer-rank">
                    {String(
                      index + 1,
                    ).padStart(
                      2,
                      '0',
                    )}
                  </div>

                  <div className="inlineoffer-store">
                    <b>
                      {
                        offer.merchant
                      }
                    </b>

                    <small>
                      {availability(
                        offer,
                      )}
                    </small>
                  </div>

                  <div className="inlineoffer-price">
                    <b>
                      {money(
                        offer.totalPrice,
                        offer.currency,
                      )}
                    </b>

                    {offer.dealScore >
                      0 &&
                      stores >=
                        2 && (
                        <small>
                          {
                            offer.dealScore
                          }
                          /100
                        </small>
                      )}
                  </div>

                  <a
                    href={offerHref(
                      offer,
                    )}
                    target="_blank"
                    rel="nofollow sponsored noopener"
                    className="inlineoffer-go"
                  >
                    Uz veikalu ↗
                  </a>
                </div>
              ),
            )}
          </div>
        ) : (
          <div className="filterempty">
            Šim variantam
            piedāvājumi vēl
            nav atrasti.
          </div>
        )}

        {selectedOffers.length >
          3 && (
          <button
            type="button"
            className="showalloffers"
            onClick={() =>
              setShowAll(
                (value: boolean) =>
                  !value,
              )
            }
          >
            {showAll
              ? 'Rādīt tikai Top 3'
              : `Rādīt visus ${selectedOffers.length} piedāvājumus`}
          </button>
        )}
      </div>
    </article>
  );
}
