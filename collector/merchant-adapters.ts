import { parseProductPage } from './product-page.ts';
import type { CollectedOffer, CollectorStore } from './types.ts';
export type MerchantAdapter = {
    slug: string;
    isProduct: (url: URL) => boolean;
    searchUrl?: (query: string) => string;
    parse: (html: string, url: string, store: CollectorStore) => CollectedOffer | null;
};
function structured(html: string, url: string, store: CollectorStore) {
    // These merchants mix credit, net, membership and marketplace prices. Require
    // a structured product offer; never guess a price from unrelated page text.
    const nodes: Record<string, any>[] = [];
    const walk = (value: any) => { if (Array.isArray(value))
        value.forEach(walk);
    else if (value && typeof value === 'object') {
        nodes.push(value);
        if (value['@graph'])
            walk(value['@graph']);
    } };
    for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            walk(JSON.parse(match[1]));
        }
        catch { }
    }
    const product = nodes.find(n => n['@type'] === 'Product' || Array.isArray(n['@type']) && n['@type'].includes('Product'));
    const productOffers = Array.isArray(product?.offers) ? product.offers : [product?.offers];
    if (!productOffers.some((o: any) => o && (o.price != null || o.lowPrice != null)))
        return null;
    const offer = parseProductPage(html, url, store);
    if (!offer || offer.currency !== 'EUR' || !Number.isFinite(offer.price) || offer.price <= 0)
        return null;
    if (store.slug === 'tet' && !/"sku"\s*:/i.test(html))
        offer.sku = offer.mpn;
    return offer;
}
export const merchantAdapters: Record<string, MerchantAdapter> = {
    dateks: { slug: 'dateks', isProduct: u => /^\/(?:en\/)?cenas\/[^/]+\/\d+-/.test(u.pathname), parse: structured },
    '1a': { slug: '1a', isProduct: u => /^\/p\/[^/]+\/[a-z0-9]+\/?$/i.test(u.pathname), parse: structured },
    aio: { slug: 'aio', isProduct: u => /^\/(?:lv|en)\/product--.+--\d+\/?$/.test(u.pathname), parse: structured },
    tet: { slug: 'tet', isProduct: u => /^\/veikals\/[^/]+\/[^/]+\.html$/.test(u.pathname) && /\d/.test(u.pathname.split('/').at(-1) || ''), searchUrl: q => `https://www.tet.lv/veikals/search?query=${encodeURIComponent(q)}`, parse: structured },
    '220': { slug: '220', isProduct: u => /^\/lv\/.+/.test(u.pathname) && /^\d+$/.test(u.searchParams.get('id') || ''), parse: structured },
};
export function adapterProductLinks(html: string, pageUrl: string, store: CollectorStore) {
    const adapter = merchantAdapters[store.slug];
    if (!adapter)
        return [];
    const host = new URL(store.origin).hostname.replace(/^www\./, '');
    const links = new Set<string>();
    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
        try {
            const u = new URL(m[1].replace(/&amp;/g, '&'), pageUrl);
            if (u.protocol !== 'https:' || u.hostname.replace(/^www\./, '') !== host || !adapter.isProduct(u))
                continue;
            u.hash = '';
            links.add(u.href);
        }
        catch { }
    }
    return [...links];
}
export function parseMerchantPage(html: string, url: string, store: CollectorStore) {
    const adapter = merchantAdapters[store.slug];
    if (!adapter)
        return parseProductPage(html, url, store);
    const u = new URL(url);
    if (!adapter.isProduct(u) || u.hostname.replace(/^www\./, '') !== new URL(store.origin).hostname.replace(/^www\./, ''))
        return null;
    return adapter.parse(html, url, store);
}
