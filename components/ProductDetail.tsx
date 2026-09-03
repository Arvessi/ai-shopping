'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import PriceChart from './PriceChart';

type Product = any;

type AiVerdict = {
  verdict: 'Pērc tagad' | 'Pagaidi' | 'Salīdzini vēl';
  summary: string;
  reasons: string[];
  confidence: 'zema' | 'vidēja' | 'augsta';
};

const money = (value: number, currency = 'EUR') =>
  new Intl.NumberFormat('lv-LV', { style: 'currency', currency }).format(value);

function shippingText(offer: any) {
  if (!offer) return 'Nav datu';
  if (Number(offer.shipping) > 0) return money(Number(offer.shipping), offer.currency);
  if (/free|bezmaksas/i.test(String(offer.deliveryMessage || ''))) return 'Bezmaksas';
  if (offer.deliveryMessage) return offer.deliveryMessage;
  return 'Nav datu';
}

export default function ProductDetail({ id }: { id: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [target, setTarget] = useState('');
  const [alertMsg, setAlertMsg] = useState('');

  const [verdict, setVerdict] = useState<AiVerdict | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(false);
  const [verdictError, setVerdictError] = useState('');

  async function load() {
    const response = await fetch(`/api/products/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || 'Produkts nav atrasts.');
      return;
    }

    setProduct(data.product);

    if (!target && data.product.currentBestPrice) {
      setTarget((data.product.currentBestPrice * 0.95).toFixed(2));
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  const best = useMemo(
    () =>
      product?.offers?.find((offer: any) => offer.isBestOverall) ||
      product?.offers?.find((offer: any) => offer.isCheapest) ||
      product?.offers?.[0],
    [product],
  );

  const hasComparison = Number(product?.offers?.length || 0) > 1;

  async function refresh() {
    setRefreshing(true);
    setError('');

    try {
      const start = await fetch(`/api/products/${encodeURIComponent(id)}/refresh`, {
        method: 'POST',
      });
      const startData = await start.json();

      if (!start.ok) {
        throw new Error(startData.error || 'Neizdevās atjaunot cenas.');
      }

      for (let attempt = 0; attempt < 35; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1600));

        const poll = await fetch(
          `/api/products/${encodeURIComponent(id)}/refresh?taskId=${encodeURIComponent(startData.taskId)}`,
        );
        const pollData = await poll.json();

        if (!poll.ok) {
          throw new Error(pollData.error || 'Neizdevās atjaunot cenas.');
        }

        if (pollData.pending) continue;

        await load();
        setVerdict(null);
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Neizdevās atjaunot.');
    } finally {
      setRefreshing(false);
    }
  }

  async function wishlist() {
    const response = await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: id }),
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (response.ok) setSaved(true);
  }

  async function createAlert() {
    setAlertMsg('');

    const response = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: id,
        targetPrice: Number(target),
        emailEnabled: true,
        browserEnabled: true,
      }),
    });

    const data = await response.json();

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    setAlertMsg(
      response.ok
        ? 'Brīdinājums izveidots ✓'
        : data.error || 'Neizdevās izveidot brīdinājumu.',
    );
  }

  async function getAiVerdict() {
    if (verdictLoading) return;

    setVerdictLoading(true);
    setVerdictError('');

    try {
      const response = await fetch(
        `/api/products/${encodeURIComponent(id)}/verdict`,
        { method: 'POST' },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'CENIQ AI analīze neizdevās.');
      }

      setVerdict(data.verdict);
    } catch (e) {
      setVerdictError(
        e instanceof Error ? e.message : 'CENIQ AI analīze neizdevās.',
      );
    } finally {
      setVerdictLoading(false);
    }
  }

  if (error && !product) {
    return (
      <div className="container standalone">
        <div className="errorbox">{error}</div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container standalone">
        <div className="loaderline">Ielādē produktu…</div>
      </div>
    );
  }

  return (
    <div className="container productpage">
      <a className="backlink" href="/">
        ← Atpakaļ uz meklēšanu
      </a>

      <section className="producthero">
        <div className="detailimage">
          {product.image ? (
            <img src={product.image} alt="" />
          ) : (
            <div className="imagefallback">C</div>
          )}
        </div>

        <div className="detailcopy">
          <div className="eyebrow">{product.brand || 'CENIQ atrasts produkts'}</div>
          <h1>{product.title}</h1>

          <div className="detailscore">
            <div>
              <span>Labākā atrastā cena</span>
              <strong>
                {product.currentBestPrice
                  ? money(product.currentBestPrice, product.currency)
                  : '—'}
              </strong>
            </div>

            <div className="score big">
              <b>{product.dealScore}</b>
              <span>/100</span>
            </div>
          </div>

          <p className="muted">
            CENIQ vērtējums ņem vērā cenu, piedāvājumu skaitu, piegādes un
            tirgotāja signālus. Ja datu ir maz, vērtējums tiek apzināti
            samazināts.
          </p>

          <div className="detailactions">
            <button className="primary" onClick={wishlist}>
              {saved ? '♥ Saglabāts' : '♡ Saglabāt izlasē'}
            </button>

            <button
              className="secondary"
              onClick={refresh}
              disabled={refreshing}
            >
              {refreshing ? 'Atjauno…' : '↻ Atjaunot cenas'}
            </button>
          </div>

          {best && (
            <div className="recommend">
              <span>{hasComparison ? '🏆 CENIQ izvēle' : 'ATRastais piedāvājums'}</span>
              <b>{best.merchant}</b>
              <p>
                {money(best.totalPrice, best.currency)} kopā · Piegāde:{' '}
                {shippingText(best)}
              </p>
            </div>
          )}

          <div className="aiverdict">
            <div className="aiverdicthead">
              <div>
                <span>✦ CENIQ AI</span>
                <h3>
                  {verdict
                    ? verdict.verdict
                    : 'Vai šo produktu ir vērts pirkt tagad?'}
                </h3>
              </div>

              {verdict && (
                <small>{verdict.confidence} pārliecība</small>
              )}
            </div>

            {verdict ? (
              <>
                <p>{verdict.summary}</p>
                <ul>
                  {verdict.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <button className="verdictrefresh" onClick={getAiVerdict}>
                  ↻ Analizēt vēlreiz
                </button>
              </>
            ) : (
              <>
                <p>
                  CENIQ AI apskatīs pašreizējo cenu, pieejamos veikalus,
                  piegādes/reitinga signālus un cenu vēsturi. Trūkstošus datus
                  tas neizdomās.
                </p>
                <button
                  className="primary"
                  onClick={getAiVerdict}
                  disabled={verdictLoading}
                >
                  {verdictLoading
                    ? 'Analizē…'
                    : '✦ Saņemt CENIQ AI viedokli'}
                </button>
              </>
            )}

            {verdictError && <small className="verdictError">{verdictError}</small>}
          </div>
        </div>
      </section>

      {error && <div className="errorbox">{error}</div>}

      <section className="detailsection">
        <div className="sectiontitle">
          <div>
            <span>SALĪDZINI</span>
            <h2>Veikalu piedāvājumi</h2>
          </div>
          <p>{product.offers.length} piedāvājumi</p>
        </div>

        <div className="offertable">
          {product.offers.map((offer: any) => (
            <div
              className={`offerrow ${
                hasComparison && offer.isBestOverall ? 'best' : ''
              }`}
              key={offer.id}
            >
              <div>
                <b>{offer.merchant}</b>
                <span>
                  {hasComparison && offer.isBestOverall
                    ? '🏆 CENIQ izvēle'
                    : hasComparison && offer.isCheapest
                      ? '💰 Lētākais'
                      : 'Piedāvājums'}
                </span>
              </div>

              <div>
                <span>Prece</span>
                <b>{money(offer.price, offer.currency)}</b>
              </div>

              <div>
                <span>Piegāde</span>
                <b>{shippingText(offer)}</b>
              </div>

              <div>
                <span>Kopā*</span>
                <strong>{money(offer.totalPrice, offer.currency)}</strong>
              </div>

              <a
                className="offercta"
                href={`/api/out?offerId=${encodeURIComponent(offer.id)}`}
                target="_blank"
                rel="nofollow sponsored noopener"
              >
                Uz veikalu ↗
              </a>
            </div>
          ))}
        </div>

        <p className="offerdisclaimer">
          * Ja piegādes cena nav pieejama avota datos, “Kopā” pašlaik nozīmē
          preces cenu. CENIQ nerāda nezināmu piegādi kā bezmaksas.
        </p>
      </section>

      <section className="twocol">
        <div className="detailsection">
          <div className="sectiontitle">
            <div>
              <span>VĒSTURE</span>
              <h2>Cenas dinamika</h2>
            </div>
          </div>
          <PriceChart points={product.snapshots} currency={product.currency} />
        </div>

        <div className="detailsection alertbox">
          <span className="eyebrow">CENU BRĪDINĀJUMS</span>
          <h2>Pasaki savu cenu.</h2>
          <p>
            Mēs pārbaudīsim cenu un paziņosim, kad tā sasniegs tavu slieksni.
          </p>

          <label>
            Mērķa cena (€)
            <input
              type="number"
              min="1"
              step="0.01"
              value={target}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setTarget(e.target.value)
              }
            />
          </label>

          <button className="primary" onClick={createAlert}>
            🔔 Izveidot brīdinājumu
          </button>

          {alertMsg && <small>{alertMsg}</small>}
        </div>
      </section>
    </div>
  );
}
