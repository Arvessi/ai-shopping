import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { prisma } from '@/lib/db';
import { canonicalizeProductTitle, extractVariantData } from '@/lib/dataforseo';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { projectFamilyToLegacy } from '@/lib/catalog';
import { LATVIA_ELECTRONICS_STORES, type StoreSeed } from '@/lib/store-registry';
import type { VariantAttributes } from '@/lib/types';

const USER_AGENT = 'CENIQBot/3.1 (+https://ceniq.lv)';
const HTML_LIMIT = 2_000_000;
const SITEMAP_URL_LIMIT = 1500;
const SITEMAP_DOC_LIMIT = 5;
const DEFAULT_PAGE_LIMIT = 8;
const RECRAWL_DAYS = 2;

const RECURRING_PRICE_PATTERN =
  /(?:\/\s*mēn|mēnesī|mēneš|\/\s*mo\b|per\s+month|monthly|month\b|nomaks|līzing|leasing|installment|instalment|abonē|subscription|pirm[aā]\s+iemaksa|first\s+payment|down\s+payment|deposit|tarifs?|plan\s+from|\b\d+\s*[x×]\s*€|\b\d+\s*mēn)/i;

const ELECTRONICS_HINT =
  /(?:iphone|ipad|macbook|airpods|galaxy|pixel|smartphone|telef|phone|laptop|notebook|portat|dator|computer|monitor|televiz|\btv\b|austi|headphone|speaker|skaļrun|kamera|camera|console|playstation|xbox|nintendo|router|rūter|ssd|hdd|gpu|videokart|processor|cpu|keyboard|klaviat|mouse|pele|watch|pulksten|tablet|planšet|vacuum|putekļ|printer|projektor|projector|audio|gaming|ledusskap|fridge|washing|veļas|trauku|dishwasher|cepeš|oven|mikroviļ|microwave|kafijas|coffee|blender|plīts|cooktop)/i;

const NON_PRODUCT_HINT =
  /(?:\/blog\/|\/news\/|\/jaunumi\/|\/article\/|\/raksti\/|\/help\/|\/faq\/|\/privacy|\/terms|\/kontakti|\/contacts|\/login|\/account|\/cart|\/grozs|\/search|[?&](?:page|sort|filter)=)/i;

const PRODUCT_PATH_HINT =
  /(?:\/p\/|\/product(?:s)?\/|\/produkts?\/|\/prece\/|\/item\/|\/shop\/[^/]+\/[^/]+|\.html?$)/i;

const CATEGORY_PATH_HINT =
  /(?:telef|dator|monitor|tv|audio|gaming|kamera|planšet|printer|elektron|smart|apple|samsung)/i;

function hash(value: string) {
  return createHash('sha1').update(value).digest('hex');
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9āčēģīķļņōŗšūž]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeUrl(value: string, base?: string) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function sameStoreHost(url: URL, origin: string) {
  const base = new URL(origin);
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const baseHost = base.hostname.replace(/^www\./i, '').toLowerCase();
  return host === baseHost || host.endsWith(`.${baseHost}`) || baseHost.endsWith(`.${host}`);
}

function urlScore(url: string, sitemapHint = '') {
  let score = 0;
  const lower = url.toLowerCase();
  const map = sitemapHint.toLowerCase();

  if (/product|produk|prece|offer|item/.test(map)) score += 8;
  if (PRODUCT_PATH_HINT.test(lower)) score += 5;
  if (CATEGORY_PATH_HINT.test(lower)) score += 2;
  if (ELECTRONICS_HINT.test(lower)) score += 3;
  if (NON_PRODUCT_HINT.test(lower)) score -= 10;

  const parsed = safeUrl(url);
  if (parsed) {
    const segments = parsed.pathname.split('/').filter(Boolean).length;
    if (segments >= 4) score += 2;
    if (segments >= 6) score += 1;
  }

  return score;
}

function parseRobots(body: string) {
  const sitemaps: string[] = [];
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | null = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;

    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }

    if (key === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if ((key === 'allow' || key === 'disallow') && current) {
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    }
  }

  const rules = groups
    .filter((group) => group.agents.some((agent) => agent === '*' || agent.includes('ceniqbot')))
    .flatMap((group) => group.rules);

  return { sitemaps, rules };
}

function robotsAllows(pathname: string, rules: Array<{ allow: boolean; path: string }>) {
  let winner: { allow: boolean; length: number } | null = null;

  for (const rule of rules) {
    const rulePath = rule.path.replace(/\*.*$/, '');
    if (!rulePath || !pathname.startsWith(rulePath)) continue;

    if (!winner || rulePath.length > winner.length || (rulePath.length === winner.length && rule.allow)) {
      winner = { allow: rule.allow, length: rulePath.length };
    }
  }

  return winner?.allow ?? true;
}

async function fetchText(url: string, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,application/json,text/plain,*/*',
      },
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = (await response.text()).slice(0, HTML_LIMIT);
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

function xmlLocations(xml: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  });

  const parsed = parser.parse(xml);
  const sitemaps = parsed?.sitemapindex?.sitemap;
  const urls = parsed?.urlset?.url;

  const asArray = (value: any) => (Array.isArray(value) ? value : value ? [value] : []);

  return {
    sitemapUrls: asArray(sitemaps)
      .map((item: any) => String(item?.loc || '').trim())
      .filter(Boolean),
    pageUrls: asArray(urls)
      .map((item: any) => String(item?.loc || '').trim())
      .filter(Boolean),
  };
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function metaContent(html: string, keys: string[]) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtmlEntities(match[1].trim());
    }
  }

  return undefined;
}

function fallbackProductFromMeta(html: string, pageUrl: string) {
  const name = metaContent(html, ['og:title', 'twitter:title', 'name']);
  const price = metaContent(html, [
    'product:price:amount',
    'og:price:amount',
    'price',
  ]);

  if (!name || !price) return null;

  return {
    '@type': 'Product',
    name,
    image: metaContent(html, ['og:image', 'twitter:image', 'image']),
    sku: metaContent(html, ['sku', 'product:retailer_item_id']),
    gtin13: metaContent(html, ['gtin13', 'ean']),
    brand: metaContent(html, ['brand', 'product:brand']),
    color: metaContent(html, ['color', 'product:color']),
    url: pageUrl,
    offers: {
      '@type': 'Offer',
      price,
      priceCurrency:
        metaContent(html, [
          'product:price:currency',
          'og:price:currency',
          'priceCurrency',
        ]) || 'EUR',
      availability: metaContent(html, [
        'product:availability',
        'availability',
      ]),
      url: pageUrl,
    },
  };
}

function jsonLdScripts(html: string) {
  const scripts: any[] = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html))) {
    const raw = decodeHtmlEntities(match[1].trim())
      .replace(/^\s*<!--/, '')
      .replace(/-->\s*$/, '')
      .trim();

    if (!raw) continue;

    try {
      scripts.push(JSON.parse(raw));
    } catch {
      // Some stores emit multiple JSON objects without an array; do not guess malformed data.
    }
  }

  return scripts;
}

function collectProducts(value: any, output: any[] = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectProducts(child, output);
    return output;
  }

  if (!value || typeof value !== 'object') return output;

  const type = value['@type'];
  const types = Array.isArray(type) ? type : [type];

  if (types.some((entry) => String(entry || '').toLowerCase() === 'product')) {
    output.push(value);
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') collectProducts(child, output);
  }

  return output;
}

function firstString(value: any): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      const result = firstString(child);
      if (result) return result;
    }
  }
  if (value && typeof value === 'object') {
    return firstString(value.url || value.contentUrl || value.name || value.value);
  }
  return undefined;
}

function numeric(value: any): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value == null) return undefined;
  const cleaned = String(value)
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeAvailability(value: any) {
  const raw = firstString(value);
  if (!raw) return undefined;
  const tail = raw.split('/').pop() || raw;
  return tail.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function productOffers(product: any) {
  const offers = product.offers;
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  const expanded: any[] = [];

  for (const offer of list) {
    if (Array.isArray(offer?.offers)) expanded.push(...offer.offers);
    expanded.push(offer);
  }

  return expanded;
}

function bestOffer(product: any) {
  const offers = productOffers(product);
  const candidates = offers
    .map((offer) => {
      const price = numeric(
        offer?.price ??
          offer?.lowPrice ??
          offer?.priceSpecification?.price,
      );

      return price && price > 0 ? { offer, price } : null;
    })
    .filter(Boolean) as Array<{ offer: any; price: number }>;

  if (!candidates.length) return null;
  return candidates.sort((a, b) => a.price - b.price)[0];
}

function brandName(product: any) {
  return firstString(product.brand?.name ?? product.brand ?? product.manufacturer?.name ?? product.manufacturer);
}

function gtinValue(product: any) {
  const value = firstString(
    product.gtin13 ?? product.gtin14 ?? product.gtin12 ?? product.gtin8 ?? product.gtin,
  );
  return value?.replace(/\D/g, '') || undefined;
}

function imageValue(product: any, offer: any) {
  return firstString(product.image ?? offer?.image);
}

function absoluteProductUrl(product: any, offer: any, pageUrl: string) {
  const raw = firstString(offer?.url ?? product.url) || pageUrl;
  return safeUrl(raw, pageUrl)?.toString() || pageUrl;
}

function extractInternalLinks(html: string, pageUrl: string, origin: string) {
  const links = new Set<string>();
  const regex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) && links.size < 120) {
    const url = safeUrl(decodeHtmlEntities(match[1]), pageUrl);
    if (!url || !sameStoreHost(url, origin)) continue;
    if (NON_PRODUCT_HINT.test(url.toString())) continue;
    links.add(url.toString());
  }

  return Array.from(links);
}

function canonicalFamilyTitle(name: string, brand?: string, _model?: string) {
  // Family identity must be stable across stores and variants. Merchant "model" fields are
  // often SKU-like codes, so the family is derived from the human product title instead.
  const canonical = canonicalizeProductTitle(name) || name;
  if (brand && !canonical.toLowerCase().startsWith(brand.toLowerCase())) {
    return `${brand} ${canonical}`.replace(/\s+/g, ' ').trim();
  }
  return canonical;
}

function productLooksElectronic(name: string, category?: string) {
  const combined = `${name} ${category || ''}`;
  if (isRestrictedShoppingQuery(combined)) return false;
  return ELECTRONICS_HINT.test(combined);
}

function variantKey(
  familyKey: string,
  attrs: VariantAttributes,
  gtin?: string,
  mpn?: string,
  sku?: string,
) {
  if (gtin) return `gtin:${gtin}`;
  if (mpn) return `mpn:${normalizeText(mpn)}`;
  if (sku) return `sku:${normalizeText(sku)}`;

  const attrString = Object.entries(attrs)
    .filter(([, value]) => Boolean(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${normalizeText(String(value))}`)
    .join('|');

  return `attrs:${hash(`${familyKey}|${attrString}`)}`;
}

function offerKey(sourceId: string, merchantId: string, external: string) {
  return hash(`${sourceId}|${merchantId}|${external}`);
}

async function ensureFeedSource(store: StoreSeed, merchantId: string) {
  return prisma.feedSource.upsert({
    where: { slug: `crawler-${store.slug}` },
    create: {
      merchantId,
      slug: `crawler-${store.slug}`,
      name: `${store.name} public product pages`,
      url: store.origin,
      format: 'crawler',
      mapping: {},
    },
    update: {
      merchantId,
      name: `${store.name} public product pages`,
      url: store.origin,
      format: 'crawler',
      active: store.enabled !== false,
    },
  });
}

export async function ensureCrawlerRegistry() {
  const sources = [];

  for (const store of LATVIA_ELECTRONICS_STORES) {
    const merchant = await prisma.merchant.upsert({
      where: { slug: store.slug },
      create: {
        slug: store.slug,
        name: store.name,
        domain: store.domain,
        active: store.enabled !== false,
      },
      update: {
        name: store.name,
        domain: store.domain,
        active: store.enabled !== false,
      },
    });

    const feed = await ensureFeedSource(store, merchant.id);

    const source = await prisma.crawlSource.upsert({
      where: { slug: store.slug },
      create: {
        slug: store.slug,
        merchantId: merchant.id,
        feedSourceId: feed.id,
        origin: store.origin,
        priority: store.priority,
        crawlDelayMs: store.crawlDelayMs || 1000,
        active: store.enabled !== false,
      },
      update: {
        merchantId: merchant.id,
        feedSourceId: feed.id,
        origin: store.origin,
        priority: store.priority,
        crawlDelayMs: store.crawlDelayMs || 1000,
        active: store.enabled !== false,
      },
    });

    sources.push(source);
  }

  return sources;
}

async function loadRobots(source: any) {
  const robotsUrl = new URL('/robots.txt', source.origin).toString();

  try {
    const { response, text } = await fetchText(robotsUrl, 6500);

    if (response.status === 401 || response.status === 403) {
      await prisma.crawlSource.update({
        where: { id: source.id },
        data: {
          robotsAllowed: false,
          robotsCheckedAt: new Date(),
          lastError: `robots.txt returned ${response.status}`,
        },
      });
      return { allowed: false, sitemaps: [], rules: [] };
    }

    if (response.ok) {
      const parsed = parseRobots(text);
      await prisma.crawlSource.update({
        where: { id: source.id },
        data: {
          robotsAllowed: true,
          robotsCheckedAt: new Date(),
          lastError: null,
        },
      });
      return { allowed: true, ...parsed };
    }
  } catch {
    // Missing robots is not treated as a ban; normal public-page behavior applies.
  }

  await prisma.crawlSource.update({
    where: { id: source.id },
    data: {
      robotsAllowed: true,
      robotsCheckedAt: new Date(),
    },
  });

  return { allowed: true, sitemaps: [], rules: [] };
}

async function enqueuePages(
  sourceId: string,
  urls: Array<{ url: string; score: number; depth?: number; kind?: string }>,
) {
  if (!urls.length) return 0;

  const deduped = new Map<string, { url: string; score: number; depth: number; kind: string }>();

  for (const item of urls) {
    const normalized = safeUrl(item.url)?.toString();
    if (!normalized) continue;
    const existing = deduped.get(normalized);
    if (!existing || item.score > existing.score) {
      deduped.set(normalized, {
        url: normalized,
        score: item.score,
        depth: item.depth || 0,
        kind: item.kind || 'candidate',
      });
    }
  }

  const rows = Array.from(deduped.values()).map((item) => ({
    sourceId,
    url: item.url,
    urlHash: hash(item.url),
    priority: item.score,
    depth: item.depth,
    kind: item.kind,
    status: 'pending',
  }));

  if (!rows.length) return 0;

  const result = await prisma.crawlPage.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return result.count;
}

async function discoverSitemapPages(source: any, sitemapUrls: string[], rules: Array<{ allow: boolean; path: string }>) {
  const fallback = [
    new URL('/sitemap.xml', source.origin).toString(),
    new URL('/sitemap_index.xml', source.origin).toString(),
    new URL('/sitemap-index.xml', source.origin).toString(),
  ];

  const queue = Array.from(new Set([...sitemapUrls, ...fallback]));
  const visited = new Set<string>();
  const pages: Array<{ url: string; score: number }> = [];

  while (queue.length && visited.size < SITEMAP_DOC_LIMIT && pages.length < SITEMAP_URL_LIMIT) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    try {
      const { response, text } = await fetchText(sitemapUrl, 9000);
      if (!response.ok || !/xml|text/i.test(response.headers.get('content-type') || 'xml')) continue;

      const parsed = xmlLocations(text);

      const childSitemaps = parsed.sitemapUrls
        .filter((url) => {
          const lower = url.toLowerCase();
          return /product|produk|prece|shop|catalog|sitemap/i.test(lower);
        })
        .sort((a, b) => urlScore(b, b) - urlScore(a, a));

      for (const child of childSitemaps.slice(0, 8)) {
        if (!visited.has(child)) queue.push(child);
      }

      for (const rawUrl of parsed.pageUrls) {
        if (pages.length >= SITEMAP_URL_LIMIT) break;
        const url = safeUrl(rawUrl);
        if (!url || !sameStoreHost(url, source.origin)) continue;
        if (!robotsAllows(url.pathname, rules)) continue;
        if (NON_PRODUCT_HINT.test(url.toString())) continue;

        const score = urlScore(url.toString(), sitemapUrl);
        if (score >= 2) pages.push({ url: url.toString(), score });
      }
    } catch {
      // Skip individual bad sitemap documents.
    }
  }

  pages.sort((a, b) => b.score - a.score);
  return pages;
}

export async function seedCrawlerSource(sourceId: string) {
  const source = await prisma.crawlSource.findUnique({
    where: { id: sourceId },
  });

  if (!source || !source.active) throw new Error('Crawler source not found or disabled.');

  const robots = await loadRobots(source);
  if (!robots.allowed) {
    return { source: source.slug, blocked: true, queued: 0 };
  }

  const pages = await discoverSitemapPages(source, robots.sitemaps, robots.rules);

  let queued = await enqueuePages(
    source.id,
    pages.map((item) => ({ ...item, kind: 'sitemap' })),
  );

  // Sitemap fallback: seed homepage as a discovery page. It may expose category/product links.
  if (!pages.length) {
    queued += await enqueuePages(source.id, [
      { url: source.origin, score: 1, kind: 'discovery', depth: 0 },
    ]);
  }

  await prisma.crawlSource.update({
    where: { id: source.id },
    data: {
      lastSeededAt: new Date(),
      lastError: null,
    },
  });

  return {
    source: source.slug,
    blocked: false,
    discovered: pages.length,
    queued,
  };
}

async function upsertJsonLdProduct(source: any, pageUrl: string, product: any) {
  const chosen = bestOffer(product);
  if (!chosen) return null;

  const { offer, price } = chosen;
  const name = firstString(product.name);
  if (!name) return null;

  const category = firstString(product.category);
  if (!productLooksElectronic(name, category)) return null;

  const joinedText = `${name} ${firstString(product.description) || ''} ${firstString(offer?.description) || ''}`;
  if (RECURRING_PRICE_PATTERN.test(joinedText) && price < 100) return null;

  const brand = brandName(product);
  const model = firstString(product.model);
  const gtin = gtinValue(product);
  const mpn = firstString(product.mpn);
  const sku = firstString(product.sku ?? offer?.sku);
  const image = imageValue(product, offer);
  const url = absoluteProductUrl(product, offer, pageUrl);
  const currency = (firstString(offer?.priceCurrency) || 'EUR').toUpperCase();
  const availability = normalizeAvailability(offer?.availability);

  const extracted = extractVariantData(name);
  const attrs: VariantAttributes = {
    storage: extracted.storage,
    ram: extracted.ram,
    color: firstString(product.color) || extracted.color,
    connectivity: extracted.connectivity,
    size: firstString(product.size) || extracted.size,
    condition: /used|refurbished|renewed|demo|lietot|atjaun/i.test(
      `${firstString(product.itemCondition) || ''} ${name}`,
    )
      ? 'Refurbished / Used'
      : 'New',
  };

  const familyTitle = canonicalFamilyTitle(name, brand, model);
  const familyKey = normalizeText(familyTitle);
  if (!familyKey) return null;

  // GTIN/EAN is the strongest cross-store identity. If another merchant already taught
  // CENIQ this exact barcode, reuse its family even when store titles differ.
  const identityVariant = gtin
    ? await prisma.catalogVariant.findFirst({
        where: { gtin },
        include: { family: true },
      })
    : mpn
      ? await prisma.catalogVariant.findFirst({
          where: {
            mpn: { equals: mpn, mode: 'insensitive' },
            family: brand
              ? { brand: { equals: brand, mode: 'insensitive' } }
              : undefined,
          },
          include: { family: true },
        })
      : null;

  const family = identityVariant?.family || await prisma.catalogFamily.upsert({
    where: { canonicalKey: familyKey },
    create: {
      canonicalKey: familyKey,
      title: familyTitle,
      normalizedTitle: familyKey,
      brand,
      model,
      category,
      image,
    },
    update: {
      title: familyTitle,
      normalizedTitle: familyKey,
      brand: brand || undefined,
      model: model || undefined,
      category: category || undefined,
      image: image || undefined,
      active: true,
    },
  });

  const effectiveFamilyKey = identityVariant?.family.canonicalKey || familyKey;
  const vKey = identityVariant?.variantKey || variantKey(effectiveFamilyKey, attrs, gtin, mpn, sku);

  const variant = await prisma.catalogVariant.upsert({
    where: {
      familyId_variantKey: {
        familyId: family.id,
        variantKey: vKey,
      },
    },
    create: {
      familyId: family.id,
      variantKey: vKey,
      gtin,
      mpn,
      color: attrs.color,
      storage: attrs.storage,
      ram: attrs.ram,
      connectivity: attrs.connectivity,
      size: attrs.size,
      condition: attrs.condition || 'New',
      attributes: JSON.parse(JSON.stringify(attrs)),
      image,
    },
    update: {
      gtin: gtin || undefined,
      mpn: mpn || undefined,
      color: attrs.color || undefined,
      storage: attrs.storage || undefined,
      ram: attrs.ram || undefined,
      connectivity: attrs.connectivity || undefined,
      size: attrs.size || undefined,
      condition: attrs.condition || 'New',
      attributes: JSON.parse(JSON.stringify(attrs)),
      image: image || undefined,
      active: true,
    },
  });

  const external = gtin || mpn || sku || url;
  const oKey = offerKey(source.feedSourceId, source.merchantId, external);

  const old = await prisma.catalogOffer.findUnique({
    where: { offerKey: oKey },
    select: {
      id: true,
      price: true,
      availability: true,
    },
  });

  const peerOffers = await prisma.catalogOffer.findMany({
    where: {
      variantId: variant.id,
      active: true,
      merchantId: { not: source.merchantId },
    },
    select: { price: true },
    take: 20,
  });

  if (peerOffers.length >= 2) {
    const peerPrices = peerOffers.map((item) => item.price).sort((a, b) => a - b);
    const middle = Math.floor(peerPrices.length / 2);
    const peerMedian = peerPrices.length % 2
      ? peerPrices[middle]
      : (peerPrices[middle - 1] + peerPrices[middle]) / 2;

    // Generic protection against a monthly/deposit price being mistaken for a full product price.
    if (peerMedian >= 100 && price < peerMedian * 0.35) {
      return null;
    }
  }

  const catalogOffer = await prisma.catalogOffer.upsert({
    where: { offerKey: oKey },
    create: {
      offerKey: oKey,
      sourceId: source.feedSourceId,
      merchantId: source.merchantId,
      variantId: variant.id,
      externalId: external,
      title: name,
      url,
      image,
      price,
      currency,
      availability,
      condition: attrs.condition || 'New',
      active: true,
      lastSeenAt: new Date(),
    },
    update: {
      variantId: variant.id,
      externalId: external,
      title: name,
      url,
      image: image || undefined,
      price,
      currency,
      availability,
      condition: attrs.condition || 'New',
      active: true,
      lastSeenAt: new Date(),
    },
  });

  if (!old || Math.abs(old.price - price) > 0.001 || old.availability !== availability) {
    await prisma.catalogPriceSnapshot.create({
      data: {
        offerId: catalogOffer.id,
        price,
        availability,
      },
    });
  }

  const activeVariantOffers = await prisma.catalogOffer.findMany({
    where: { variantId: variant.id, active: true },
    select: { id: true, price: true },
    orderBy: { price: 'asc' },
    take: 30,
  });

  if (activeVariantOffers.length >= 3) {
    const prices = activeVariantOffers.map((item) => item.price);
    const middle = Math.floor(prices.length / 2);
    const med = prices.length % 2
      ? prices[middle]
      : (prices[middle - 1] + prices[middle]) / 2;

    if (med >= 100) {
      await prisma.catalogOffer.updateMany({
        where: {
          variantId: variant.id,
          active: true,
          price: { lt: med * 0.35 },
        },
        data: { active: false },
      });
    }
  }

  await projectFamilyToLegacy(family.id);

  return { familyId: family.id, offerId: catalogOffer.id, name, price };
}

type RobotsContext = {
  allowed: boolean;
  sitemaps: string[];
  rules: Array<{ allow: boolean; path: string }>;
};

async function processPage(page: any, source: any, robotsContext?: RobotsContext) {
  const url = safeUrl(page.url);
  if (!url || !sameStoreHost(url, source.origin)) {
    throw new Error('URL is outside configured merchant origin.');
  }

  const robots = robotsContext || await loadRobots(source);
  if (!robots.allowed || !robotsAllows(url.pathname, robots.rules)) {
    await prisma.crawlPage.update({
      where: { id: page.id },
      data: {
        status: 'blocked',
        lastCrawledAt: new Date(),
        nextCrawlAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    return { blocked: true, products: 0 };
  }

  const { response, text } = await fetchText(url.toString(), 9000);

  if (response.status === 401 || response.status === 403 || response.status === 429) {
    await prisma.crawlPage.update({
      where: { id: page.id },
      data: {
        status: 'blocked',
        attempts: { increment: 1 },
        lastHttpStatus: response.status,
        lastCrawledAt: new Date(),
        nextCrawlAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return { blocked: true, products: 0 };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    await prisma.crawlPage.update({
      where: { id: page.id },
      data: {
        status: 'done',
        lastHttpStatus: response.status,
        lastCrawledAt: new Date(),
        nextCrawlAt: new Date(Date.now() + RECRAWL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    return { blocked: false, products: 0 };
  }

  const products = jsonLdScripts(text).flatMap((script) => collectProducts(script));
  if (!products.length) {
    const fallback = fallbackProductFromMeta(text, url.toString());
    if (fallback) products.push(fallback);
  }

  let accepted = 0;

  for (const product of products.slice(0, 8)) {
    const result = await upsertJsonLdProduct(source, url.toString(), product);
    if (result) accepted += 1;
  }

  if (!accepted && page.depth < 2) {
    const links = extractInternalLinks(text, url.toString(), source.origin)
      .map((link) => ({
        url: link,
        score: urlScore(link),
        depth: page.depth + 1,
        kind: urlScore(link) >= 5 ? 'candidate' : 'discovery',
      }))
      .filter((item) => item.score >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);

    await enqueuePages(source.id, links);
  }

  await prisma.crawlPage.update({
    where: { id: page.id },
    data: {
      status: accepted ? 'product' : 'done',
      attempts: { increment: 1 },
      lastHttpStatus: response.status,
      lastError: null,
      lastCrawledAt: new Date(),
      nextCrawlAt: new Date(Date.now() + RECRAWL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  return { blocked: false, products: accepted };
}

export async function crawlSourceBatch(sourceId: string, limit = DEFAULT_PAGE_LIMIT) {
  const source = await prisma.crawlSource.findUnique({
    where: { id: sourceId },
    include: { merchant: true },
  });

  if (!source || !source.active) throw new Error('Crawler source not found or disabled.');

  const now = new Date();
  const pages = await prisma.crawlPage.findMany({
    where: {
      sourceId: source.id,
      OR: [
        { status: 'pending' },
        { nextCrawlAt: { lte: now } },
      ],
      NOT: { status: 'blocked' },
    },
    orderBy: [
      { priority: 'desc' },
      { lastCrawledAt: 'asc' },
      { createdAt: 'asc' },
    ],
    take: Math.min(20, Math.max(1, limit)),
  });

  let products = 0;
  let errors = 0;
  let blocked = 0;

  const robots = await loadRobots(source);
  if (!robots.allowed) {
    return {
      source: source.slug,
      pages: 0,
      products: 0,
      blocked: pages.length,
      errors: 0,
    };
  }

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];

    try {
      const result = await processPage(page, source, robots);
      products += result.products;
      if (result.blocked) blocked += 1;
    } catch (error) {
      errors += 1;
      await prisma.crawlPage.update({
        where: { id: page.id },
        data: {
          status: 'error',
          attempts: { increment: 1 },
          lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Crawler error',
          lastCrawledAt: new Date(),
          nextCrawlAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      }).catch(() => undefined);
    }

    if (index < pages.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1800, source.crawlDelayMs)));
    }
  }

  await prisma.crawlSource.update({
    where: { id: source.id },
    data: {
      lastRunAt: new Date(),
      lastError: errors ? `${errors} page(s) failed in last batch` : null,
    },
  });

  return {
    source: source.slug,
    pages: pages.length,
    products,
    blocked,
    errors,
  };
}

function queryTokens(query: string) {
  return normalizeText(query)
    .split(' ')
    .filter((token) => token.length >= 3)
    .slice(0, 5);
}

async function findQueryPages(query: string, limit: number) {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];

  return prisma.crawlPage.findMany({
    where: {
      source: {
        active: true,
        robotsAllowed: { not: false },
      },
      AND: [
        ...tokens.map((token) => ({
          url: { contains: token, mode: 'insensitive' as const },
        })),
        {
          OR: [
            { status: 'pending' },
            { nextCrawlAt: { lte: new Date() } },
          ],
        },
      ],
    },
    include: {
      source: true,
    },
    orderBy: { priority: 'desc' },
    take: Math.min(30, Math.max(4, limit * 4)),
  });
}

export async function crawlQueryCandidates(query: string, limit = 8) {
  const tokens = queryTokens(query);
  if (!tokens.length) return { pages: 0, products: 0, seeded: null as string | null };

  let candidates = await findQueryPages(query, limit);
  let seeded: string | null = null;

  const candidateSourceCount = new Set(candidates.map((item) => item.sourceId)).size;

  // While the catalog is young, a real user search also teaches CENIQ one new store.
  // This prevents waiting weeks for a full background crawl, while still respecting robots.txt.
  if (candidateSourceCount < Math.min(4, limit)) {
    const unseeded = await prisma.crawlSource.findFirst({
      where: {
        active: true,
        lastSeededAt: null,
      },
      orderBy: { priority: 'desc' },
    });

    if (unseeded) {
      const seed = await seedCrawlerSource(unseeded.id).catch(() => null);
      if (seed && !('error' in seed)) seeded = unseeded.slug;
      candidates = await findQueryPages(query, limit);
    }
  }

  const chosen: typeof candidates = [];
  const seenSources = new Set<string>();

  for (const candidate of candidates) {
    if (seenSources.has(candidate.sourceId)) continue;
    seenSources.add(candidate.sourceId);
    chosen.push(candidate);
    if (chosen.length >= limit) break;
  }

  let products = 0;

  // One page per different store: safe to run a few in parallel without hammering one host.
  const results = await Promise.allSettled(
    chosen.map((page) => processPage(page, page.source)),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') products += result.value.products;
  }

  return { pages: chosen.length, products, seeded };
}

export async function runCrawlerCycle(pageLimit = DEFAULT_PAGE_LIMIT) {
  await ensureCrawlerRegistry();

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const needsSeed = await prisma.crawlSource.findFirst({
    where: {
      active: true,
      OR: [
        { lastSeededAt: null },
        { lastSeededAt: { lt: weekAgo } },
      ],
    },
    orderBy: [
      { priority: 'desc' },
      { lastSeededAt: 'asc' },
    ],
  });

  let seedResult: any = null;
  if (needsSeed) {
    seedResult = await seedCrawlerSource(needsSeed.id).catch((error) => ({
      source: needsSeed.slug,
      error: error instanceof Error ? error.message : 'Seed failed',
    }));
  }

  const source = await prisma.crawlSource.findFirst({
    where: {
      active: true,
      pages: {
        some: {
          OR: [
            { status: 'pending' },
            { nextCrawlAt: { lte: new Date() } },
          ],
          NOT: { status: 'blocked' },
        },
      },
    },
    orderBy: [
      { lastRunAt: 'asc' },
      { priority: 'desc' },
    ],
  });

  const crawlResult = source
    ? await crawlSourceBatch(source.id, pageLimit)
    : null;

  return { seedResult, crawlResult };
}

export async function crawlerStatus() {
  const [sources, pages, products, pending, blocked, errors] = await Promise.all([
    prisma.crawlSource.findMany({
      where: { active: true },
      include: { merchant: true },
      orderBy: { priority: 'desc' },
    }),
    prisma.crawlPage.count(),
    prisma.crawlPage.count({ where: { status: 'product' } }),
    prisma.crawlPage.count({ where: { status: 'pending' } }),
    prisma.crawlPage.count({ where: { status: 'blocked' } }),
    prisma.crawlPage.count({ where: { status: 'error' } }),
  ]);

  return {
    stores: sources.map((source) => ({
      slug: source.slug,
      name: source.merchant.name,
      origin: source.origin,
      robotsAllowed: source.robotsAllowed,
      lastSeededAt: source.lastSeededAt,
      lastRunAt: source.lastRunAt,
      lastError: source.lastError,
    })),
    totals: { pages, products, pending, blocked, errors },
  };
}
