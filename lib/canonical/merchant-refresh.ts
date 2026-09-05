import { fetchText } from '../../collector/http.ts';
import { collectorStores } from '../../collector/store-registry.ts';
import { adapterProductLinks, merchantAdapters, parseMerchantPage } from '../../collector/merchant-adapters.ts';
import { sameProduct } from '../../collector/relevance.ts';
import { persistCollectedOffers } from '../../collector/canonical-bridge.ts';
import { discoverProductUrls } from '../../collector/discovery.ts';
import type { CollectedOffer } from '../../collector/types.ts';
import { getCanonicalProduct } from './catalog';
import { prisma } from '../db';
export async function refreshMerchantCoverage(jobId: string, familyId: string, query: string) {
    const started = Date.now();
    let calls = 0;
    const offers: CollectedOffer[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    try {
        const before = await getCanonicalProduct(familyId);
        const baseline = before?.bestPrice || 0;
        async function collect(url: string, slug: string) {
            if (seen.has(url) || Date.now() - started > 45000)
                return;
            seen.add(url);
            const store = collectorStores.find(s => s.slug === slug);
            if (!store)
                return;
            try {
                const html = await fetchText(url, 5000);
                const parsed = parseMerchantPage(html, url, store);
                if (parsed && sameProduct(parsed.title, query) && (!baseline || (parsed.price >= baseline * .4 && parsed.price <= baseline * 2.5)))
                    offers.push(parsed);
            }
            catch (e) {
                errors.push(`${slug}: ${e instanceof Error ? e.message : 'fetch failed'}`);
            }
        }
        // Merchant search/category adapters run before discovery. Access-denied pages
        // are recorded, never retried with impersonation or challenge bypasses.
        await Promise.all(Object.values(merchantAdapters).map(async (adapter) => {
            const store = collectorStores.find(s => s.slug === adapter.slug);
            if (!store)
                return;
            const listing = adapter.searchUrl?.(query) || store.catalogUrls?.[0];
            if (!listing)
                return;
            try {
                const html = await fetchText(listing, 5000);
                const urls = adapterProductLinks(html, listing, store).filter(url => !adapter.searchUrl || sameProduct(decodeURIComponent(new URL(url).pathname).replace(/[-/]/g, ' '), query));
                await Promise.all(urls.slice(0, 3).map(url => collect(url, store.slug)));
            }
            catch (e) {
                errors.push(`${store.slug}: listing unavailable`);
            }
        }));
        // Refresh known direct product pages, still subject to the same validation.
        await Promise.all((before?.offers || []).filter(o => o.url).slice(0, 5).map(o => { const host = new URL(o.url!).hostname.replace(/^www\./, ''); const store = collectorStores.find(s => new URL(s.origin).hostname.replace(/^www\./, '') === host); return store ? collect(o.url!, store.slug) : Promise.resolve(); }));
        const coverage = new Set([...(before?.offers || []).map(o => o.merchantDomain || o.merchant), ...offers.map(o => new URL(o.url).hostname.replace(/^www\./, ''))]).size;
        const stale = await prisma.merchantOffer.count({ where: { variant: { familyId }, validationStatus: 'ACCEPTED', lastSeenAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }) === 0;
        if ((coverage < 3 || stale) && process.env.TAVILY_API_KEY) {
            const clusters = [['dateks.lv', '1a.lv', 'aio.lv'], ['tet.lv', '220.lv'], ['balticdata.lv', 'evelatus.lv', 'tehnoland.lv']];
            for (const domains of clusters) {
                if (calls >= 3 || Date.now() - started > 30000)
                    break;
                calls++;
                try {
                    const found = await discoverProductUrls(query, { knownMerchantsOnly: true, includeDomains: domains, maxResults: 4 });
                    await Promise.all(found.candidates.slice(0, 3).map(c => c.merchantSlug ? collect(c.url, c.merchantSlug) : Promise.resolve()));
                }
                catch (e) {
                    errors.push('Discovery provider unavailable');
                }
            }
        }
        const persisted = await persistCollectedOffers(offers);
        const after = await getCanonicalProduct(familyId);
        await prisma.enrichmentJob.update({ where: { id: jobId }, data: { status: !offers.length && errors.length ? 'failed' : 'succeeded', providerStage: 'merchant-done', finishedAt: new Date(), lastError: !offers.length && errors.length ? 'Publiskie veikalu avoti pašlaik nav pieejami. Mēģini vēlāk.' : persisted.accepted ? 'Piedāvājumi pārbaudīti. Pieņemtie piedāvājumi ir pievienoti salīdzinājumam.' : 'Jauni atbilstoši piedāvājumi netika atrasti.' } });
        console.info('CENIQ merchant refresh', { familyId, tavilyCalls: calls, accepted: persisted.accepted, before: before?.storesCount || 0, after: after?.storesCount || 0, sourceErrors: errors.length });
    }
    catch (e) {
        await prisma.enrichmentJob.update({ where: { id: jobId }, data: { status: 'failed', finishedAt: new Date(), lastError: e instanceof Error ? e.message : 'Merchant refresh failed' } });
    }
}
