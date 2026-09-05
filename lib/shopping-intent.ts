import type { AiShoppingPlan, ProductResult, VariantAttributes } from './types.ts';
export type ShoppingIntent = AiShoppingPlan & {
    minPrice?: number;
    requiredSpecs: Partial<VariantAttributes>;
    useCases: string[];
    comparisonTargets: string[];
    brandPreference?: string;
};
export type Recommendation = {
    product: ProductResult;
    matched: string[];
    unknown: string[];
    advantage: string;
    tradeoff: string;
};
const clean = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export function parseShoppingIntent(prompt: string): ShoppingIntent {
    const q = clean(prompt);
    const budget = prompt.match(/(?:līdz|lidz|zem|under|up to|max(?:imum)?|budžets?\s*(?:ir)?)\s*€?\s*(\d+(?:[.,]\d+)?)/i);
    const range = prompt.match(/(?:no|from)\s*€?\s*(\d+)\s*(?:€|eur|eiro)?\s*(?:līdz|lidz|to|-)\s*€?\s*(\d+)/i);
    const maxPrice = range ? Number(range[2]) : budget ? Number(budget[1].replace(',', '.')) : undefined;
    const minPrice = range ? Number(range[1]) : undefined;
    const comparisonTargets = /salidzini|compare|\bvs\b|versus/.test(q)
        ? prompt.replace(/^(?:salīdzini|salidzini|compare)\s*/i, '').split(/\s+(?:un|and|vs\.?|versus)\s+/i).slice(0, 2).map(s => s.trim()).filter(Boolean) : [];
    const category = /portativ|laptop|notebook|macbook/.test(q) ? 'laptop' : /telefon|smartphone|iphone|galaxy/.test(q) ? 'smartphone' : /\btv\b|televiz|oled|qled/.test(q) ? 'TV' : /monitor/.test(q) ? 'monitor' : /austin|audio|headphone/.test(q) ? 'headphones' : /kamer|camera/.test(q) ? 'camera' : '';
    const requiredSpecs: Partial<VariantAttributes> = {};
    const ram = prompt.match(/(\d+)\s*GB\s*RAM/i);
    const storage = prompt.match(/(\d+)\s*(GB|TB)(?!\s*RAM)/i);
    const size = prompt.match(/(\d+(?:[.,]\d+)?)\s*(?:coll\w*|inch\w*|[″"])/i);
    const hz = prompt.match(/(\d+)\s*Hz/i);
    const panel = prompt.match(/\b(OLED|QLED|IPS|mini\s*LED)\b/i);
    if (ram)
        requiredSpecs.ram = `${ram[1]} GB`;
    if (storage)
        requiredSpecs.storage = `${storage[1]} ${storage[2].toUpperCase()}`;
    if (size)
        requiredSpecs.size = size[1].replace(',', '.');
    if (hz)
        requiredSpecs.refreshRate = `${hz[1]} Hz`;
    if (panel)
        requiredSpecs.panelType = panel[1].toUpperCase();
    const useCases = [/kamer/.test(q) && category === 'smartphone' ? 'Kameras kvalitāte' : '', /gaming|spelu/.test(q) ? 'Spēles' : '', /montaz|video/.test(q) ? 'Video montāža' : '', /darb/.test(q) ? 'Darbs' : ''].filter(Boolean);
    const brandPreference = prompt.match(/\b(Apple|Samsung|Lenovo|Sony|LG|Asus|Acer|Dell|HP|Canon)\b/i)?.[1];
    const model = prompt.match(/\b(?:iPhone\s*\d+\w*(?:\s+(?:Pro Max|Pro|Plus))?|(?:Samsung\s+)?Galaxy\s+[A-Z]\d+(?:\s+(?:Ultra|FE|Plus))?|MacBook\s+Air\s+M\d+)\b/i)?.[0];
    const searchQuery = comparisonTargets[0] || model || category || prompt.slice(0, 180);
    const constraints = [...(maxPrice ? [`Līdz ${maxPrice} €`] : []), ...Object.values(requiredSpecs), ...useCases];
    return { searchQuery, category, maxPrice, minPrice, requiredSpecs, useCases, comparisonTargets, brandPreference,
        constraints, summary: comparisonTargets.length === 2 ? 'Salīdzinājums pēc CENIQ katalogā pārbaudāmiem datiem.' : 'Atlase pēc tava budžeta un zināmajām specifikācijām. Trūkstošos datus norādām atsevišķi.' };
}
export function rankShoppingProducts(products: ProductResult[], intent: ShoppingIntent): Recommendation[] {
    const rows: Array<Recommendation & {
        rank: number;
    }> = [];
    for (const product of products) {
        if (/\b(case|cover|charger|adapter|cable|protector|glass)\b/i.test(product.title))
            continue;
        const variants = product.catalogVariants?.filter(v => v.offerCount > 0) || [];
        for (const variant of variants.length ? variants : [undefined]) {
            const offers = product.offers.filter(o => (!variant || o.variantId === variant.id) && Number.isFinite(o.totalPrice) && o.totalPrice > 0 && o.currency === 'EUR').sort((a, b) => a.totalPrice - b.totalPrice);
            if (!offers.length)
                continue;
            const price = offers[0].totalPrice;
            if ((intent.maxPrice && price > intent.maxPrice) || (intent.minPrice && price < intent.minPrice))
                continue;
            const attrs = variant?.attributes || offers[0].variantData || {};
            if (attrs.condition && attrs.condition !== 'New')
                continue;
            const matched: string[] = [], unknown: string[] = [];
            let mismatch = false;
            for (const [axis, wanted] of Object.entries(intent.requiredSpecs)) {
                const actual = attrs[axis as keyof VariantAttributes];
                if (!actual) {
                    unknown.push(`${axis}: ${wanted}`);
                    continue;
                }
                const numeric = (s: string) => Number(s.match(/\d+(?:\.\d+)?/)?.[0] || 0) * (/TB/i.test(s) ? 1024 : 1);
                const fits = ['ram', 'storage', 'refreshRate'].includes(axis) ? numeric(actual) >= numeric(wanted) : axis === 'size' ? numeric(actual) === numeric(wanted) : clean(actual) === clean(wanted);
                if (!fits)
                    mismatch = true;
                else
                    matched.push(`${axis}: ${actual}`);
            }
            if (mismatch)
                continue;
            const stores = new Set(offers.map(o => o.merchantDomain || o.merchant)).size;
            const score = stores >= 2 ? Math.max(...offers.map(o => o.dealScore || 0)) : 0;
            const useCaseUnknown = intent.useCases.map(value => `${value} — katalogā nav salīdzināma kvalitātes vērtējuma`);
            rows.push({ product: { ...product, selectedVariantId: variant?.id, bestPrice: price, storesCount: stores, dealScore: score, offers, image: variant?.image || product.image }, matched, unknown: [...unknown, ...useCaseUnknown],
                advantage: `${stores} ${stores === 1 ? 'veikals' : 'veikali'} · ${matched.length ? `${matched.length} pārbaudītas prasības` : 'zināma aktuālā cena'}`,
                tradeoff: unknown.length ? 'Daļa prasību nav pārbaudāma; pirms pirkuma pārbaudi specifikāciju.' : useCaseUnknown.length ? 'Lietojuma kvalitāti nevar secināt tikai no cenas un specifikācijām.' : stores < 2 ? 'Tikai viens veikals — cenu konkurence nav pārbaudāma.' : 'Cena un pieejamība var mainīties; pārbaudi veikalā.',
                rank: matched.length * 100 - unknown.length * 100 + Math.min(stores, 10) * 3 + score / 10 + (intent.brandPreference && clean(product.brand || '') === clean(intent.brandPreference) ? 5 : 0) - price / 10000 });
        }
    }
    const seen = new Set<string>();
    return rows.sort((a, b) => b.rank - a.rank).filter(row => { if (seen.has(row.product.id))
        return false; seen.add(row.product.id); return true; }).slice(0, 6).map(({ rank, ...row }) => row);
}
