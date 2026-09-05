'use client';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import PriceChart from './PriceChart';
type Product = any;
type Verdict = {
    verdict: 'Pērc tagad' | 'Pagaidi' | 'Salīdzini vēl';
    summary: string;
    reasons: string[];
    confidence: 'zema' | 'vidēja' | 'augsta';
};
const AXIS_LABELS: Record<string, string> = { storage: 'Atmiņa', ram: 'RAM', color: 'Krāsa', connectivity: 'Savienojums', size: 'Izmērs', cpu: 'Procesors', gpu: 'Grafika', resolution: 'Izšķirtspēja', panelType: 'Panelis', refreshRate: 'Frekvence', kit: 'Komplekts', condition: 'Stāvoklis' };
const AXIS_ORDER = ['storage', 'ram', 'color', 'connectivity', 'size', 'cpu', 'gpu', 'resolution', 'panelType', 'refreshRate', 'kit', 'condition'];
function money(value: number, currency = 'EUR') { try {
    return new Intl.NumberFormat('lv-LV', { style: 'currency', currency }).format(value);
}
catch {
    return `${value.toFixed(2)} ${currency}`;
} }
function merchantKey(offer: any) { return String(offer.merchantDomain || offer.merchant || 'unknown').toLowerCase().replace(/^www\./, ''); }
function matchVariant(offer: any, selected: Record<string, string>) { const data = offer.variantData || {}; return Object.entries(selected).every(([key, value]) => !value || data[key] === value); }
function specRows(attributes: Record<string, string> | undefined) { if (!attributes)
    return []; return AXIS_ORDER.map(axis => ({ axis, label: AXIS_LABELS[axis] || axis, value: attributes[axis] })).filter(item => Boolean(item.value) && !(item.axis === 'condition' && item.value === 'New')).slice(0, 8); }
export default function ProductDetail({ id, variantId }: {
    id: string;
    variantId?: string;
}) {
    const [refreshMsg, setRefreshMsg] = useState('');
    const [product, setProduct] = useState<Product | null>(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [enriching, setEnriching] = useState(false);
    const [saved, setSaved] = useState(false);
    const [target, setTarget] = useState('');
    const [alertMsg, setAlertMsg] = useState('');
    const [showAll, setShowAll] = useState(false);
    const [selected, setSelected] = useState<Record<string, string>>({});
    const [verdict, setVerdict] = useState<Verdict | null>(null);
    const [verdictProvider, setVerdictProvider] = useState('');
    const [verdictLoading, setVerdictLoading] = useState(false);
    const [verdictError, setVerdictError] = useState('');
    const autoEnrichStarted = useRef(false);
    async function load(requestedVariantId = variantId) {
        const response = await fetch(`/api/products/${encodeURIComponent(id)}${requestedVariantId ? `?variantId=${encodeURIComponent(requestedVariantId)}` : ''}`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) {
            setError(data.error || 'Produkts nav atrasts.');
            return null;
        }
        setError('');
        setProduct(data.product);
        if (!target && data.product.currentBestPrice)
            setTarget((data.product.currentBestPrice * .95).toFixed(2));
        return data.product;
    }
    useEffect(() => { void load().catch(() => setError('Produktu neizdevās ielādēt. Mēģini vēlreiz.')); }, [id, variantId]);
    const allOffers = useMemo(() => product?.offers || [], [product]);
    const catalogVariants = useMemo(() => product?.catalogVariants || [], [product?.catalogVariants]);
    const variantOptions = useMemo(() => { const map = new Map<string, Set<string>>(); const sources = catalogVariants.length ? catalogVariants.map((variant: any) => ({ variantData: variant.attributes })) : allOffers; for (const source of sources) {
        for (const [key, value] of Object.entries(source.variantData || {})) {
            if (!value)
                continue;
            if (!map.has(key))
                map.set(key, new Set());
            map.get(key)!.add(String(value));
        }
    } return Object.fromEntries(Array.from(map.entries()).map(([key, values]) => [key, Array.from(values)])) as Record<string, string[]>; }, [allOffers, catalogVariants]);
    useEffect(() => { if (Object.keys(selected).length || !allOffers.length)
        return; const preferred = catalogVariants.find((variant: any) => variant.id === product?.selectedVariantId); if (preferred) {
        setSelected(preferred.attributes || {});
        return;
    } const cheapest = [...allOffers].sort((a: any, b: any) => a.totalPrice - b.totalPrice)[0]; setSelected(cheapest?.variantData || {}); }, [allOffers, catalogVariants, product, selected]);
    const selectedVariant = useMemo(() => catalogVariants.find((variant: any) => Object.entries(selected).every(([key, value]) => !value || variant.attributes?.[key] === value)), [catalogVariants, selected]);
    function chooseVariantAxis(axis: string, option: string) {
        const candidates = catalogVariants.filter((v: any) => v.offerCount > 0 && v.attributes?.[axis] === option);
        const matches = (v: any) => Object.entries(selected).filter(([key, value]) => key !== axis && v.attributes?.[key] === value).length;
        const exact = [...candidates].sort((a: any, b: any) => matches(b) - matches(a) || b.offerCount - a.offerCount)[0];
        if (!exact && catalogVariants.length)
            return;
        setSelected(exact?.attributes || { ...selected, [axis]: option });
        setShowAll(false);
        setVerdict(null);
        if (exact) {
            window.history.replaceState(window.history.state, '', `/product/${encodeURIComponent(id)}?variantId=${encodeURIComponent(exact.id)}`);
            void load(exact.id).catch(() => setError('Variantu neizdevās ielādēt.'));
        }
    }
    const filteredOffers = useMemo(() => { const attrs = selectedVariant?.attributes || selected; return allOffers.filter((offer: any) => matchVariant(offer, attrs)).sort((a: any, b: any) => a.totalPrice - b.totalPrice); }, [allOffers, selected, selectedVariant]);
    const storeCount = useMemo(() => new Set(filteredOffers.map((offer: any) => merchantKey(offer))).size, [filteredOffers]);
    const totalStoreCount = useMemo(() => new Set(allOffers.map((offer: any) => merchantKey(offer))).size, [allOffers]);
    const best = filteredOffers[0];
    const bestScore = storeCount >= 2 ? Math.max(0, ...filteredOffers.map((offer: any) => Number(offer.dealScore || 0))) : 0;
    const visibleOffers = showAll ? filteredOffers : filteredOffers.slice(0, 6);
    const selectedImage = selectedVariant?.image || filteredOffers.find((offer: any) => Boolean(offer.image))?.image || product?.familyImage || product?.image || '';
    const specs = specRows(selectedVariant?.attributes || selected);
    async function runRefresh(force = false, silent = false) { if (refreshing || enriching)
        return; silent ? setEnriching(true) : setRefreshing(true); if (!silent)
        setError(''); try {
        const start = await fetch(`/api/products/${encodeURIComponent(id)}/refresh?force=${force ? '1' : '0'}`, { method: 'POST' });
        const startData = await start.json();
        if (!start.ok)
            throw new Error(startData.error || 'Neizdevās atrast vairāk piedāvājumu.');
        if (!startData.pending) {
            await load(selectedVariant?.id);
            setRefreshMsg(startData.message || 'Piedāvājumi pārbaudīti.');
            return;
        }
        let stage = startData.stage || 'sellers';
        let taskId = startData.taskId;
        let retryAfterMs = 750;
        for (let attempt = 0; attempt < 40; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, retryAfterMs));
            const poll = await fetch(`/api/products/${encodeURIComponent(id)}/refresh?stage=${encodeURIComponent(stage)}&taskId=${encodeURIComponent(taskId)}`);
            const pollData = await poll.json();
            if (!poll.ok)
                throw new Error(pollData.error || 'Piedāvājumu atjaunošana neizdevās.');
            if (pollData.pending) {
                retryAfterMs = Math.min(8000, Math.max(500, Number(pollData.retryAfterMs || retryAfterMs * 1.7)));
                stage = pollData.stage || stage;
                taskId = pollData.taskId || taskId;
                continue;
            }
            await load(selectedVariant?.id);
            setRefreshMsg(pollData.message || 'Piedāvājumi pārbaudīti.');
            setVerdict(null);
            return;
        }
        throw new Error('Veikalu meklēšana aizņēma pārāk ilgu laiku.');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Neizdevās atjaunot.');
    }
    finally {
        setRefreshing(false);
        setEnriching(false);
    } }
    useEffect(() => { if (!product || autoEnrichStarted.current)
        return; const last = product.lastEnrichedAt ? new Date(product.lastEnrichedAt).getTime() : 0; const stale = !last || Date.now() - last > 12 * 60 * 60 * 1000; if (stale && (totalStoreCount < 2 || !product.image)) {
        autoEnrichStarted.current = true;
        const timer = window.setTimeout(() => void runRefresh(false, true), 500);
        return () => window.clearTimeout(timer);
    } }, [product, totalStoreCount]);
    async function wishlist() { try {
        const response = await fetch('/api/wishlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ familyId: product.id, variantId: selectedVariant?.id }) });
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        if (response.ok)
            setSaved(true);
        else
            setError('Neizdevās saglabāt produktu.');
    }
    catch {
        setError('Neizdevās saglabāt produktu.');
    } }
    async function createAlert() { setAlertMsg(''); try {
        const response = await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ familyId: product.id, variantId: selectedVariant?.id, targetPrice: Number(target), emailEnabled: true, browserEnabled: true }) });
        const data = await response.json();
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        setAlertMsg(response.ok ? 'Brīdinājums izveidots ✓' : data.error || 'Neizdevās izveidot brīdinājumu.');
    }
    catch {
        setAlertMsg('Neizdevās izveidot brīdinājumu. Mēģini vēlreiz.');
    } }
    async function getVerdict() { if (verdictLoading)
        return; setVerdictLoading(true); setVerdictError(''); try {
        const response = await fetch(`/api/products/${encodeURIComponent(id)}/verdict${selectedVariant?.id ? `?variantId=${encodeURIComponent(selectedVariant.id)}` : ''}`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok)
            throw new Error(data.error || 'CENIQ analīze neizdevās.');
        setVerdict(data.verdict);
        setVerdictProvider(data.provider || '');
    }
    catch (e) {
        setVerdictError(e instanceof Error ? e.message : 'CENIQ analīze neizdevās.');
    }
    finally {
        setVerdictLoading(false);
    } }
    if (error && !product)
        return <div className="container intel-standalone"><div className="errorbox">{error}</div></div>;
    if (!product)
        return <div className="container intel-standalone"><div className="loaderline">Ielādē produktu…</div></div>;
    return <div className="container product-intelligence">
    <a className="backlink" href="/">← Atpakaļ uz meklēšanu</a>
    <header className="intelligence-heading"><span className="eyebrow">CENIQ / PRODUKTA ANALĪZE</span><h1>{product.title}</h1><p>{product.brand} · {totalStoreCount} veikali katalogā</p></header>
    <div className="intelligence-layout">
      <div className="intelligence-content">
        <section className="product-studio"><div className="studio-media">{selectedImage ? <img src={selectedImage} alt={product.title}/> : <span className="imagefallback">C</span>}</div><div className="studio-configuration"><span className="eyebrow">TAVS VARIANTS</span><div className="variant-controls">{AXIS_ORDER.map(axis => { const options = variantOptions[axis] || []; return options.length > 1 ? <label key={axis}>{AXIS_LABELS[axis]}<select value={selected[axis] || ''} onChange={e => chooseVariantAxis(axis, e.target.value)}>{options.map(option => <option key={option}>{option}</option>)}</select></label> : null; })}</div><dl className="specification-list">{specs.map(spec => <div key={spec.axis}><dt>{spec.label}</dt><dd>{spec.value}</dd></div>)}</dl></div></section>
        <section className="merchant-market" id="veikali"><header className="section-heading"><div><span className="eyebrow">VEIKALU PIEDĀVĀJUMI</span><h2>Tavs variants. {storeCount} {storeCount === 1 ? 'veikals' : 'veikali'}.</h2></div></header><div className="merchant-ladder">{visibleOffers.map((offer: any, index: number) => <div className={`merchant-step ${index === 0 ? 'best' : ''}`} key={offer.id || `${merchantKey(offer)}-${index}`}><span className="merchant-number">{index === 0 ? '↗' : String(index + 1).padStart(2, '0')}</span><div><b>{offer.merchant}</b><small>{offer.deliveryMessage || 'Pieejamību pārbaudīt veikalā'}{storeCount >= 2 && offer.dealScore > 0 ? ` · CENIQ ${offer.dealScore}/100` : ''}</small></div><div className="merchant-value"><strong>{money(offer.totalPrice, offer.currency)}</strong><small>{index === 0 ? 'Zemākā cena' : `+${money(offer.totalPrice - best.totalPrice, offer.currency)}`}</small></div><a href={`/api/out?offerId=${encodeURIComponent(offer.id)}`} target="_blank" rel="nofollow sponsored noopener" aria-label={`Atvērt ${offer.merchant}`}>↗</a></div>)}</div>{!visibleOffers.length && <p className="emptybox">Šim variantam nav piedāvājumu.</p>}{filteredOffers.length > 6 && <button className="textbtn" onClick={() => setShowAll(value => !value)}>{showAll ? 'Rādīt mazāk' : `Visi ${filteredOffers.length} piedāvājumi ↓`}</button>}</section>
        <section className="price-history"><span className="eyebrow">CENU VĒSTURE</span><h2>Kā mainījusies cena?</h2><PriceChart points={product.snapshots || []} currency={product.currency}/></section>
        <section className="ceniq-verdict"><span className="eyebrow">✳ CENIQ VĒRTĒJUMS</span><h2>{verdict?.verdict || 'Vai ir īstais brīdis?'}</h2>{verdict ? <><p>{verdict.summary}</p><ul>{verdict.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><small>{verdict.confidence} pārliecība · {storeCount} veikali · {verdictProvider === 'gemini' ? 'Gemini' : 'CENIQ noteikumu analīze'}</small></> : <><p>Novērtē pašreizējo cenu, cenu kontekstu un tirgus pārklājumu.</p><button className="secondary" onClick={getVerdict} disabled={verdictLoading}>{verdictLoading ? 'Analizē…' : 'Saņemt vērtējumu ↗'}</button></>}{verdictError && <p role="alert" className="errorbox">{verdictError}</p>}</section>
      </div>
      <aside className="market-control"><span className="eyebrow">LABĀKĀ ZINĀMĀ CENA</span><strong className="control-price">{best ? money(best.totalPrice, best.currency) : '—'}</strong><p>{best?.merchant || 'Piedāvājumu nav'}</p><div className="control-metrics"><div><b>{storeCount}</b><span>veikali</span></div><div><b>{bestScore > 0 ? bestScore : '—'}</b><span>CENIQ / 100</span></div></div>{best && <a className="primary" href={`/api/out?offerId=${encodeURIComponent(best.id)}`} target="_blank" rel="nofollow sponsored noopener">Uz labāko veikalu ↗</a>}<button className="secondary" onClick={wishlist}>{saved ? '♥ Saglabāts' : '♡ Saglabāt izvēli'}</button><button className="textbtn" onClick={() => runRefresh(true, false)} disabled={refreshing || enriching}>{refreshing || enriching ? 'CENIQ meklē vēl veikalus…' : 'Atrast vairāk veikalu ↻'}</button>{error && <p className="errorbox" role="alert">{error}</p>}{refreshMsg && <p role="status">{refreshMsg}</p>}
        {filteredOffers.length > 1 && <div className="control-range"><small>Cenu diapazons šim variantam</small><b>{money(best.totalPrice)} — {money(filteredOffers[filteredOffers.length - 1].totalPrice)}</b></div>}
        <form className="price-alert" onSubmit={e => { e.preventDefault(); void createAlert(); }}><span className="eyebrow">TAVA MĒRĶA CENA</span><h3>Gaidām labāku cenu?</h3><label htmlFor="alert-target">Paziņot, kad cena ir zem (€)</label><input id="alert-target" type="number" min="1" step="0.01" required value={target} onChange={e => setTarget(e.target.value)}/><button className="secondary">Izveidot brīdinājumu</button>{alertMsg && <p role="status">{alertMsg}</p>}</form>
      </aside>
    </div>
  </div>;
}
