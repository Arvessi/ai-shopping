import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { prisma } from '@/lib/db';
import { canonicalizeProductTitle, extractVariantData } from '@/lib/dataforseo';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { projectFamilyToLegacy } from '@/lib/catalog';
import { LATVIA_ELECTRONICS_STORES, getStoreSeed, type StoreSeed } from '@/lib/store-registry';
import type { VariantAttributes } from '@/lib/types';

const USER_AGENT = 'CENIQBot/3.2 (+https://ceniq.lv)';
const HTML_LIMIT = 2_000_000;
const SITEMAP_URL_LIMIT = 1500;
const SITEMAP_DOC_LIMIT = 4;
const DEFAULT_PAGE_LIMIT = 10;
const QUERY_STORE_LIMIT = Math.min(14, Math.max(6, Number(process.env.CENIQ_QUERY_STORE_LIMIT || 10)));
const QUERY_PAGES_PER_STORE = Math.min(3, Math.max(1, Number(process.env.CENIQ_QUERY_PAGES_PER_STORE || 3)));
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

function stripTags(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUERY_STOPWORDS = new Set([
  'the', 'and', 'with', 'for', 'from', 'lidz', 'līdz', 'zem', 'virs', 'best',
  'good', 'labs', 'laba', 'labu', 'mekle', 'meklē', 'atrast', 'price', 'cena',
  'jauns', 'jauna', 'new', 'nopirkt', 'pirkt', 'veikals',
]);

function queryTokens(query: string) {
  return normalizeText(query)
    .split(' ')
    .filter((token) => token.length >= 2 && !QUERY_STOPWORDS.has(token))
    .slice(0, 7);
}

function queryMatchScore(value: string, query: string) {
  const haystack = normalizeText(value);
  const tokens = queryTokens(query);

  if (!tokens.length) return 0;

  let score = 0;
  let matched = 0;

  for (const token of tokens) {
    if (!haystack.includes(token)) continue;
    matched += 1;

    if (/^\d+$/.test(token)) {
      score += 4;
    } else if (/\d/.test(token)) {
      score += 5;
    } else if (token.length >= 6) {
      score += 4;
    } else {
      score += 3;
    }
  }

  if (matched === tokens.length) score += 10;
  if (matched >= Math.min(2, tokens.length)) score += 5;

  return score;
}

function extractScoredLinks(
  html: string,
  pageUrl: string,
  origin: string,
  query: string,
) {
  const links = new Map<string, { url: string; score: number }>();
  const regex = /<a\b([^>]*)href=["']([^"'#]+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) && links.size < 300) {
    const url = safeUrl(decodeHtmlEntities(match[2]), pageUrl);
    if (!url || !sameStoreHost(url, origin)) continue;
    if (NON_PRODUCT_HINT.test(url.toString())) continue;

    const anchor = stripTags(match[4]);
    const score =
      queryMatchScore(`${anchor} ${url.pathname}`, query) +
      Math.max(0, urlScore(url.toString()));

    if (score < 7) continue;

    const key = url.toString();
    const existing = links.get(key);
    if (!existing || score > existing.score) {
      links.set(key, { url: key, score });
    }
  }

  return Array.from(links.values()).sort((a, b) => b.score - a.score);
}

function fillSearchTemplate(template: string, query: string) {
  const q = encodeURIComponent(query.trim());
  const plus = encodeURIComponent(query.trim().replace(/\s+/g, '+'));
  return template
    .replace(/\{q\}/g, q)
    .replace(/\{plus\}/g, plus);
}

function storageHint(value: string) {
  const normalized = value.toLowerCase();
  const tb = normalized.match(/(?:^|[^0-9])(\d+(?:[.,]\d+)?)\s*tb(?:[^a-z]|$)/i);
  if (tb) return `${tb[1].replace(',', '.')}tb`;

  const gb = normalized.match(/(?:^|[^0-9])(64|128|256|512|1024)\s*(?:gb|g)(?:[^a-z]|$)/i);
  return gb ? `${gb[1]}gb` : '';
}

function colorHint(value: string) {
  const normalized = value.toLowerCase();
  const colors = [
    'black', 'white', 'pink', 'teal', 'ultramarine', 'blue', 'green',
    'red', 'yellow', 'purple', 'gray', 'grey', 'silver', 'gold',
    'midnight', 'starlight', 'titanium',
  ];

  return colors.find((color) => normalized.includes(color)) || '';
}

function diversifyQueryPages(
  items: Array<{ url: string; score: number }>,
  query: string,
  limit: number,
) {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  if (sorted.length <= limit) return sorted;

  const requestedStorage = storageHint(query);
  const chosen: Array<{ url: string; score: number }> = [];
  const used = new Set<string>();

  const take = (item: { url: string; score: number }) => {
    if (chosen.length >= limit || used.has(item.url)) return;
    used.add(item.url);
    chosen.push(item);
  };

  if (!requestedStorage) {
    const seenStorage = new Set<string>();

    for (const item of sorted) {
      const storage = storageHint(item.url);
      if (!storage || seenStorage.has(storage)) continue;
      seenStorage.add(storage);
      take(item);
      if (chosen.length >= limit) return chosen;
    }
  }

  const seenVariant = new Set<string>();
  for (const item of sorted) {
    const storage = storageHint(item.url) || 'base';
    const color = colorHint(item.url) || 'base';
    const key = `${storage}|${color}`;

    if (seenVariant.has(key)) continue;
    seenVariant.add(key);
    take(item);
    if (chosen.length >= limit) return chosen;
  }

  for (const item of sorted) {
    take(item);
    if (chosen.length >= limit) break;
  }

  return chosen;
}

function searchFormCandidates(html: string, origin: string, query: string) {
  const candidates = new Set<string>();
  const formRegex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let formMatch: RegExpExecArray | null;

  while ((formMatch = formRegex.exec(html)) && candidates.size < 4) {
    const attrs = formMatch[1];
    const body = formMatch[2];

    const actionMatch = attrs.match(/\baction=["']([^"']+)["']/i);
    const methodMatch = attrs.match(/\bmethod=["']([^"']+)["']/i);
    const method = (methodMatch?.[1] || 'get').toLowerCase();

    if (method !== 'get') continue;

    const inputs = Array.from(body.matchAll(/<input\b[^>]*\bname=["']([^"']+)["'][^>]*>/gi))
      .map((match) => match[1])
      .filter(Boolean);

    const searchName = inputs.find((name) =>
      /^(q|query|search|searchterm|keyword|keywords|term|text)$/i.test(name),
    );

    if (!searchName) continue;

    const action = safeUrl(actionMatch?.[1] || '/', origin);
    if (!action || !sameStoreHost(action, origin)) continue;

    action.searchParams.set(searchName, query);
    candidates.add(action.toString());
  }

  return Array.from(candidates);
}

async function discoverQueryFromSearchPages(
  source: any,
  query: string,
  robots: RobotsContext,
) {
  const store = getStoreSeed(source.slug);
  const candidates = new Map<string, { url: string; score: number }>();

  const collectSearchPage = async (searchUrl: string) => {
    const parsed = safeUrl(searchUrl);
    if (!parsed || !sameStoreHost(parsed, source.origin)) return;
    if (!robotsAllows(parsed.pathname, robots.rules)) return;

    try {
      const { response, text } = await fetchText(searchUrl, 5000);
      if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') || '')) return;

      const pageProducts = jsonLdScripts(text).flatMap((script) => collectProducts(script));
      for (const product of pageProducts.slice(0, 30)) {
        const chosen = bestOffer(product);
        const name = firstString(product?.name);
        if (!chosen || !name || queryMatchScore(name, query) < 5) continue;

        const url = absoluteProductUrl(product, chosen.offer, searchUrl);
        const productUrl = safeUrl(url);
        if (!productUrl || !sameStoreHost(productUrl, source.origin)) continue;

        candidates.set(url, {
          url,
          score: 40 + queryMatchScore(name, query),
        });
      }

      for (const item of extractScoredLinks(text, searchUrl, source.origin, query).slice(0, 18)) {
        const existing = candidates.get(item.url);
        if (!existing || item.score > existing.score) {
          candidates.set(item.url, item);
        }
      }
    } catch {
      // Try another search endpoint or sitemap fallback.
    }
  };

  const configuredSearchUrls: string[] = Array.from(
    new Set<string>(
      (store?.searchTemplates || []).map((template: string) =>
        fillSearchTemplate(template, query),
      ),
    ),
  ).slice(0, 2);

  for (const searchUrl of configuredSearchUrls) {
    await collectSearchPage(searchUrl);
    if (candidates.size >= QUERY_PAGES_PER_STORE * 2) break;
  }

  // Only inspect the homepage for a search form when the configured endpoints did not help.
  if (candidates.size < QUERY_PAGES_PER_STORE) {
    try {
      const { response, text } = await fetchText(source.origin, 4000);
      if (response.ok && /text\/html/i.test(response.headers.get('content-type') || '')) {
        const discovered = searchFormCandidates(text, source.origin, query).slice(0, 2);
        for (const searchUrl of discovered) {
          await collectSearchPage(searchUrl);
          if (candidates.size >= QUERY_PAGES_PER_STORE * 2) break;
        }
      }
    } catch {
      // Sitemap fallback handles stores without a discoverable search form.
    }
  }

  return diversifyQueryPages(
    Array.from(candidates.values()),
    query,
    QUERY_PAGES_PER_STORE * 3,
  );
}

async function discoverQueryFromSitemaps(
  source: any,
  query: string,
  robots: RobotsContext,
) {
  const fallback = [
    new URL('/sitemap.xml', source.origin).toString(),
    new URL('/sitemap_index.xml', source.origin).toString(),
    new URL('/sitemap-index.xml', source.origin).toString(),
  ];

  const queue = Array.from(new Set([...robots.sitemaps, ...fallback]));
  const visited = new Set<string>();
  const candidates = new Map<string, { url: string; score: number }>();

  while (
    queue.length &&
    visited.size < Math.min(3, SITEMAP_DOC_LIMIT) &&
    candidates.size < QUERY_PAGES_PER_STORE * 8
  ) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    try {
      const { response, text } = await fetchText(sitemapUrl, 4500);
      if (!response.ok) continue;

      const parsed = xmlLocations(text);

      const childSitemaps = parsed.sitemapUrls
        .filter((url) => /product|produk|prece|shop|catalog|sitemap/i.test(url))
        .sort((a, b) => {
          const aScore = queryMatchScore(a, query) + urlScore(a, a);
          const bScore = queryMatchScore(b, query) + urlScore(b, b);
          return bScore - aScore;
        });

      for (const child of childSitemaps.slice(0, 10)) {
        if (!visited.has(child)) queue.push(child);
      }

      for (const rawUrl of parsed.pageUrls) {
        const url = safeUrl(rawUrl);
        if (!url || !sameStoreHost(url, source.origin)) continue;
        if (!robotsAllows(url.pathname, robots.rules)) continue;
        if (NON_PRODUCT_HINT.test(url.toString())) continue;

        const match = queryMatchScore(url.pathname, query);
        if (match < 5) continue;

        const score = 15 + match + Math.max(0, urlScore(url.toString(), sitemapUrl));
        const key = url.toString();
        const existing = candidates.get(key);
        if (!existing || score > existing.score) {
          candidates.set(key, { url: key, score });
        }
      }
    } catch {
      // Skip a bad sitemap document.
    }
  }

  return diversifyQueryPages(
    Array.from(candidates.values()),
    query,
    QUERY_PAGES_PER_STORE * 3,
  );
}

async function discoverQueryPagesForSource(
  source: any,
  query: string,
) {
  const robots = await loadRobots(source);

  if (!robots.allowed) {
    return { source, robots, pages: [] as Array<{ url: string; score: number }> };
  }

  const searchPages = await discoverQueryFromSearchPages(
    source,
    query,
    robots,
  );

  const sitemapPages =
    searchPages.length >= QUERY_PAGES_PER_STORE
      ? []
      : await discoverQueryFromSitemaps(
          source,
          query,
          robots,
        );

  const merged = new Map<string, { url: string; score: number }>();

  for (const item of [...searchPages, ...sitemapPages]) {
    const existing = merged.get(item.url);
    if (!existing || item.score > existing.score) merged.set(item.url, item);
  }

  return {
    source,
    robots,
    pages: diversifyQueryPages(
      Array.from(merged.values()),
      query,
      QUERY_PAGES_PER_STORE,
    ),
  };
}

function canonicalFamilyTitle(name: string, brand?: string, _model?: string) {
  // One consumer product family must be identical across stores even when titles put the
  // brand/category in a different position: "Apple iPhone 16" vs "iPhone 16 Apple".
  let canonical = canonicalizeProductTitle(name) || name;

  canonical = canonical
    .replace(
      /\b(mobilais telefons|viedtālrunis|viedtalrunis|smartphone|mobile phone|telefons)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (!brand) return canonical;

  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  canonical = canonical
    .replace(new RegExp(`^${escaped}\\s+`, 'i'), '')
    .replace(new RegExp(`\\s+${escaped}$`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim();

  return `${brand} ${canonical}`
    .replace(/\s+/g, ' ')
    .trim();
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
  // GTIN is exact. After that prefer visible consumer attributes over retailer SKU/MPN,
  // because SKU and regional MPN values often differ between shops for the same variant.
  if (gtin) return `gtin:${gtin}`;

  const attrString = Object.entries(attrs)
    .filter(
      ([key, value]) =>
        Boolean(value) &&
        !(key === 'condition' && value === 'New'),
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${normalizeText(String(value))}`)
    .join('|');

  if (attrString) {
    return `attrs:${hash(`${familyKey}|${attrString}`)}`;
  }

  if (mpn) return `mpn:${normalizeText(mpn)}`;
  if (sku) return `sku:${normalizeText(sku)}`;

  return `base:${hash(familyKey)}`;
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
    const { response, text } = await fetchText(robotsUrl, 4500);

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

function crawlerColor(name: string) {
  const rules: Array<[RegExp, string]> = [
    [/\bteal\b/i, 'Teal'],
    [/\bultramarine\b/i, 'Ultramarine'],
    [/\bspace black\b/i, 'Space Black'],
    [/\bmidnight\b/i, 'Midnight'],
    [/\bstarlight\b/i, 'Starlight'],
    [/\bdesert titanium\b/i, 'Desert Titanium'],
    [/\bnatural titanium\b/i, 'Natural Titanium'],
    [/\bwhite titanium\b/i, 'White Titanium'],
    [/\bblack titanium\b/i, 'Black Titanium'],
  ];

  for (const [pattern, value] of rules) {
    if (pattern.test(name)) return value;
  }

  return undefined;
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
    color: firstString(product.color) || crawlerColor(name) || extracted.color,
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

  const knownAttributeFilters: Record<string, unknown> = {};
  for (const axis of ['storage', 'ram', 'color', 'connectivity', 'size'] as const) {
    const value = attrs[axis];
    if (value) {
      knownAttributeFilters[axis] = {
        equals: value,
        mode: 'insensitive',
      };
    }
  }

  const attributeVariant =
    !identityVariant && Object.keys(knownAttributeFilters).length
      ? await prisma.catalogVariant.findFirst({
          where: {
            familyId: family.id,
            condition: attrs.condition || 'New',
            ...knownAttributeFilters,
          },
        })
      : null;

  const vKey =
    identityVariant?.variantKey ||
    attributeVariant?.variantKey ||
    variantKey(effectiveFamilyKey, attrs, gtin, mpn, sku);

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
    const peerPrices = peerOffers.map((item: { price: number }) => item.price).sort((a: number, b: number) => a - b);
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
    const prices = activeVariantOffers.map((item: { id: string; price: number }) => item.price);
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

async function existingQueryPages(query: string, limit: number) {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];

  const tokenFilters = tokens.map((token) => ({
    url: { contains: token, mode: 'insensitive' as const },
  }));

  return prisma.crawlPage.findMany({
    where: {
      source: {
        active: true,
        robotsAllowed: { not: false },
      },
      OR: [
        {
          AND: tokenFilters,
        },
        {
          AND: tokenFilters.slice(0, Math.min(2, tokenFilters.length)),
        },
      ],
      NOT: { status: 'blocked' },
    },
    include: {
      source: true,
    },
    orderBy: [
      { priority: 'desc' },
      { lastCrawledAt: 'asc' },
    ],
    take: Math.min(40, Math.max(8, limit * 5)),
  });
}

async function processDiscoveredSource(
  source: any,
  query: string,
) {
  try {
    const discovered = await discoverQueryPagesForSource(source, query);

    if (!discovered.robots.allowed || !discovered.pages.length) {
      return {
        source: source.slug,
        pages: 0,
        products: 0,
        blocked: !discovered.robots.allowed,
      };
    }

    await enqueuePages(
      source.id,
      discovered.pages.map((item) => ({
        ...item,
        kind: 'query',
        depth: 0,
      })),
    );

    const savedPages = await prisma.crawlPage.findMany({
      where: {
        sourceId: source.id,
        urlHash: {
          in: discovered.pages.map((item) => hash(item.url)),
        },
      },
      orderBy: { priority: 'desc' },
      take: QUERY_PAGES_PER_STORE,
    });

    let products = 0;
    let blocked = false;

    for (let index = 0; index < savedPages.length; index += 1) {
      const page = savedPages[index];

      try {
        const result = await processPage(
          page,
          source,
          discovered.robots,
        );

        products += result.products;
        blocked ||= result.blocked;
      } catch (error) {
        await prisma.crawlPage.update({
          where: { id: page.id },
          data: {
            status: 'error',
            attempts: { increment: 1 },
            lastError:
              error instanceof Error
                ? error.message.slice(0, 1000)
                : 'Query crawler error',
            lastCrawledAt: new Date(),
            nextCrawlAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
          },
        }).catch(() => undefined);
      }

      if (index < savedPages.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(650, source.crawlDelayMs || 650)),
        );
      }
    }

    await prisma.crawlSource.update({
      where: { id: source.id },
      data: {
        lastRunAt: new Date(),
        lastError: null,
      },
    }).catch(() => undefined);

    return {
      source: source.slug,
      pages: savedPages.length,
      products,
      blocked,
    };
  } catch (error) {
    await prisma.crawlSource.update({
      where: { id: source.id },
      data: {
        lastError:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : 'Query discovery failed',
        lastRunAt: new Date(),
      },
    }).catch(() => undefined);

    return {
      source: source.slug,
      pages: 0,
      products: 0,
      blocked: false,
      error:
        error instanceof Error
          ? error.message
          : 'Query discovery failed',
    };
  }
}

export async function crawlQueryCandidates(query: string, limit = QUERY_STORE_LIMIT) {
  const tokens = queryTokens(query);

  if (!tokens.length) {
    return {
      pages: 0,
      products: 0,
      storesTried: 0,
      storeResults: [],
    };
  }

  await ensureCrawlerRegistry();

  const existing = await existingQueryPages(query, limit);
  const existingBySource = new Map<string, typeof existing>();

  for (const page of existing) {
    existingBySource.set(page.sourceId, [
      ...(existingBySource.get(page.sourceId) || []),
      page,
    ]);
  }

  let products = 0;
  let pages = 0;

  // First consume already-known matching URLs. This is cheap and makes repeated searches fast.
  const existingChosen = Array.from(existingBySource.values())
    .slice(0, Math.min(limit, 5));

  const cachedResults = await Promise.allSettled(
    existingChosen.map(async (items) => {
      const page = items[0];
      return processPage(page, page.source);
    }),
  );

  for (const result of cachedResults) {
    if (result.status === 'fulfilled') {
      pages += 1;
      products += result.value.products;
    }
  }

  const sourceLimit = Math.min(
    QUERY_STORE_LIMIT,
    Math.max(6, limit),
  );

  // Query-discovery is deliberately spread across different stores, never many requests to one host.
  const sources = await prisma.crawlSource.findMany({
    where: {
      active: true,
      robotsAllowed: { not: false },
    },
    include: { merchant: true },
    orderBy: [
      { priority: 'desc' },
      { lastRunAt: 'asc' },
    ],
    take: sourceLimit,
  });

  const storeResults = await Promise.all(
    sources.map((source: any) =>
      processDiscoveredSource(source, query),
    ),
  );

  for (const result of storeResults) {
    pages += result.pages;
    products += result.products;
  }

  return {
    pages,
    products,
    storesTried: sources.length,
    storeResults,
  };
}


export async function runCrawlerCycle(pageLimit = DEFAULT_PAGE_LIMIT) {
  await ensureCrawlerRegistry();

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const needsSeed = await prisma.crawlSource.findMany({
    where: {
      active: true,
      OR: [
        { lastSeededAt: null },
        { lastSeededAt: { lt: weekAgo } },
      ],
    },
    orderBy: [
      { lastSeededAt: 'asc' },
      { priority: 'desc' },
    ],
    take: 4,
  });

  const seedResults = [];
  for (const source of needsSeed) {
    try {
      seedResults.push(await seedCrawlerSource(source.id));
    } catch (error) {
      seedResults.push({
        source: source.slug,
        error: error instanceof Error ? error.message : 'Seed failed',
      });
    }
  }

  const sources = await prisma.crawlSource.findMany({
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
    take: 4,
  });

  const crawlResults = [];
  for (const source of sources) {
    try {
      crawlResults.push(
        await crawlSourceBatch(
          source.id,
          Math.min(8, Math.max(2, Math.ceil(pageLimit / Math.max(1, sources.length)))),
        ),
      );
    } catch (error) {
      crawlResults.push({
        source: source.slug,
        error: error instanceof Error ? error.message : 'Crawl failed',
      });
    }
  }

  return {
    seededStores: seedResults,
    crawledStores: crawlResults,
  };
}

export async function crawlerStatus() {
  await ensureCrawlerRegistry();

  const [
    sources,
    pages,
    productPages,
    pending,
    blocked,
    errors,
    families,
    variants,
    offers,
  ] = await Promise.all([
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
    prisma.catalogFamily.count({ where: { active: true } }),
    prisma.catalogVariant.count({ where: { active: true } }),
    prisma.catalogOffer.count({ where: { active: true } }),
  ]);

  return {
    stores: sources.map((source: any) => ({
      slug: source.slug,
      name: source.merchant.name,
      origin: source.origin,
      robotsAllowed: source.robotsAllowed,
      lastSeededAt: source.lastSeededAt,
      lastRunAt: source.lastRunAt,
      lastError: source.lastError,
    })),
    totals: {
      pages,
      productPages,
      pending,
      blocked,
      errors,
      catalogFamilies: families,
      catalogVariants: variants,
      catalogOffers: offers,
    },
  };
}
