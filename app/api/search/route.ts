import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { databaseConfigured, prisma } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { getCanonicalProduct, searchCanonicalCatalog } from '@/lib/canonical/catalog';
import { shapeCanonicalResults } from '@/lib/canonical/result-shaping';
import { reconcileStrongFamilies } from '@/lib/canonical/reconcile-results';
import { canonicalizeMerchantProductTitle } from '@/lib/canonical/title-normalization';
import { normalizeText } from '@/lib/canonical/domain';
import type { ProductResult } from '@/lib/types';

export const maxDuration = 10;

const ACCESSORY = /\b(?:case|cover|screen\s*protector|protective|tempered\s*glass|glass|charger|adapter|cable|holder|maci[nņ]s|vaci[nņ]s|apvalks|aizsargstikls|stikls|vāciņš|maciņš)\b/i;
const CONDITION = /\b(?:izpakota|izpakots|refurb(?:ished)?|lietota|lietots|used|demo)\b/i;

const CATEGORY_ALIASES: Array<{ pattern: RegExp; needles: string[] }> = [
  { pattern: /\b(smartphone|phone|telefoni?|viedt[aā]lru[nņ])\b/i, needles: ['phone', 'smartphone', 'telef', 'mobile'] },
  { pattern: /\b(laptop|notebook|portat[iī]v)\b/i, needles: ['laptop', 'notebook', 'portat'] },
  { pattern: /\b(monitor|display|displej)\b/i, needles: ['monitor', 'display'] },
  { pattern: /\b(tv|televizor|oled|qled)\b/i, needles: ['tv', 'televiz', 'oled'] },
  { pattern: /\b(headphone|headphones|austi[nņ]|audio)\b/i, needles: ['audio', 'headphone', 'austi'] },
  { pattern: /\b(camera|kamera|foto)\b/i, needles: ['camera', 'kamera', 'foto'] },
  { pattern: /\b(gaming|sp[eē][lļ]u)\b/i, needles: ['gaming', 'game', 'spēl'] },
  { pattern: /\b(appliance|sadz[iī]ves\s+tehnika|virtuve)\b/i, needles: ['appliance', 'sadzīves', 'virtu'] },
  { pattern: /\b(sport|fitness)\b/i, needles: ['sport', 'fitness'] },
  { pattern: /\b(bike|bicycle|velo|velosip)\b/i, needles: ['bike', 'velo', 'velosip'] },
  { pattern: /\b(beauty|kosm[eē]tik|skaistum)\b/i, needles: ['beauty', 'kosm', 'skaist'] },
  { pattern: /\b(toy|toys|rota[lļ]liet|b[eē]rniem)\b/i, needles: ['toy', 'rotaļ', 'bērn'] },
  { pattern: /\b(home|m[aā]jai|furniture|m[eē]beles)\b/i, needles: ['home', 'māj', 'furniture', 'mēbel'] },
];

function productIntentCompatible(title: string, query: string) {
  if (!ACCESSORY.test(query) && ACCESSORY.test(title)) return false;
  if (!CONDITION.test(query) && CONDITION.test(title)) return false;
  return true;
}

function coverage(results: ProductResult[]) {
  return Math.max(0, ...results.map((product) => product.storesCount || 0));
}

function variantCount(results: ProductResult[]) {
  return Math.max(0, ...results.map((product) => product.catalogVariants?.filter((variant) => variant.offerCount > 0).length || 0));
}

function mergeProducts(...sets: ProductResult[][]) {
  const merged = new Map<string, ProductResult>();
  for (const set of sets) for (const product of set) if (!merged.has(product.id)) merged.set(product.id, product);
  return [...merged.values()];
}

function categoryNeedles(query: string) {
  const normalized = normalizeText(query);
  return CATEGORY_ALIASES.find(({ pattern }) => pattern.test(normalized))?.needles || [];
}

async function categoryFallback(query: string) {
  const needles = categoryNeedles(query);
  if (!needles.length) return [];

  const rows = await prisma.productFamily.findMany({
    where: {
      status: 'ACTIVE',
      OR: needles.flatMap((needle) => [
        { category: { contains: needle, mode: 'insensitive' as const } },
        { normalizedTitle: { contains: needle, mode: 'insensitive' as const } },
      ]),
    },
    select: { id: true },
    take: 24,
  });

  const products = await Promise.all(rows.map((row) => getCanonicalProduct(row.id)));
  return products.filter((product): product is ProductResult => Boolean(product));
}

async function searchCatalogWithFallback(query: string) {
  const primary = await searchCanonicalCatalog(query);
  const canonicalQuery = canonicalizeMerchantProductTitle(query).title.trim();
  const canonical = canonicalQuery && normalizeText(canonicalQuery) !== normalizeText(query)
    ? await searchCanonicalCatalog(canonicalQuery)
    : [];
  const categories = primary.length >= 8 ? [] : await categoryFallback(query);
  return mergeProducts(primary, canonical, categories).filter((product) => productIntentCompatible(product.title, query));
}

async function prioritizeV2(results: ProductResult[], query: string) {
  if (results.length < 2) return { results, v2Families: 0 };
  const familyIds = results.map((product) => product.id).filter(Boolean);
  const freshAfter = new Date(Date.now() - Math.max(1, Number(process.env.OFFER_MAX_AGE_HOURS || 48)) * 60 * 60 * 1000);
  const rows = await prisma.merchantOffer.findMany({
    where: {
      sourceType: 'collector-v2',
      validationStatus: 'ACCEPTED',
      priceKind: 'ONE_TIME',
      totalPrice: { not: null },
      lastSeenAt: { gte: freshAfter },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      variant: { familyId: { in: familyIds } },
    },
    select: { variant: { select: { familyId: true } } },
  });
  const current = new Set(rows.map((row) => row.variant.familyId));
  if (!current.size) return { results, v2Families: 0 };

  const requested = normalizeText(canonicalizeMerchantProductTitle(query).title || query);
  const relevance = (product: ProductResult) => {
    const title = normalizeText(product.title);
    if (title === requested) return 4;
    if (title.startsWith(requested) || requested.startsWith(title)) return 3;
    if (requested.split(' ').every((token) => title.includes(token))) return 2;
    return 1;
  };

  const sorted = [...results].sort((a, b) => {
    const v2 = Number(current.has(b.id)) - Number(current.has(a.id));
    return v2 || relevance(b) - relevance(a) || (b.storesCount || 0) - (a.storesCount || 0) || a.bestPrice - b.bestPrice;
  });
  return { results: sorted, v2Families: current.size };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const q = String(body?.q || '').trim();
    const mode = body?.mode === 'assistant' ? 'assistant' : 'search';

    if (!q) return NextResponse.json({ error: 'Ievadi meklējamo produktu.' }, { status: 400 });
    if (isRestrictedShoppingQuery(q)) return NextResponse.json({ error: 'CENIQ šo produktu kategoriju nemeklē.' }, { status: 400 });
    if (!databaseConfigured()) return NextResponse.json({ error: 'CENIQ katalogam nav konfigurēta datubāze.' }, { status: 503 });

    const user = await getSessionUser();
    prisma.searchLog.create({ data: { query: q.slice(0, 700), mode, userId: user?.id } }).catch(() => undefined);

    // Interactive search is strictly catalogue/DB-only. No Tavily, Brave or DataForSEO.
    const rawResults = await searchCatalogWithFallback(q);
    const reconciled = reconcileStrongFamilies(rawResults);
    const shaped = shapeCanonicalResults(reconciled, q).filter((product) => productIntentCompatible(product.title, q));
    const prioritized = await prioritizeV2(shaped, q);
    const results = prioritized.results;
    const bestCoverage = coverage(results);
    const bestVariants = variantCount(results);

    return NextResponse.json({
      results,
      source: 'canonical-catalog',
      cached: true,
      message: results.length ? undefined : 'Šis produkts pašreizējā CENIQ katalogā vēl nav indeksēts.',
      diagnostics: {
        rawProductGroups: rawResults.length,
        reconciledProductGroups: reconciled.length,
        productGroups: results.length,
        v2ProductGroups: prioritized.v2Families,
        bestCoverage,
        bestVariants,
        paidProviderCalls: 0,
        families: results.slice(0, 12).map((product) => ({
          id: product.id,
          title: product.title,
          stores: product.storesCount || 0,
          variants: product.catalogVariants?.filter((variant) => variant.offerCount > 0).length || 0,
          offers: product.offers?.length || 0,
          hasImage: Boolean(product.image),
        })),
      },
      expansion: { enabled: false, query: q, reason: 'scheduled-catalogue-only' },
      enrichment: { enabled: false, query: q, jobId: null },
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('CENIQ canonical search:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Meklēšana neizdevās.' },
      { status: 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Search polling is not used.' }, { status: 410 });
}
