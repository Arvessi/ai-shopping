import { discoveryMerchants } from "./discovery-merchants.ts";

export type DiscoverySource = "tavily" | "brave";

export type DiscoveryCandidate = {
  source: DiscoverySource;
  url: string;
  title: string;
  snippet?: string;
  domain: string;
  merchantSlug?: string;
  market?: "LV" | "LT" | "EE" | "EU";
  deliveryToLatvia?: "native" | "verify";
};

export type DiscoveryResult = {
  source: DiscoverySource;
  query: string;
  candidates: DiscoveryCandidate[];
};

export type DiscoveryOptions = {
  maxResults?: number;
  knownMerchantsOnly?: boolean;
  country?: string;
  language?: string;
};

const TAVILY_SEARCH_DEPTH = "basic" as const;
const MAX_RESULTS_PER_DISCOVERY_CALL = 20;

function hostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function merchantForUrl(url: string) {
  const domain = hostname(url);
  return discoveryMerchants.find((merchant) => {
    const merchantDomain = hostname(merchant.origin);
    return domain === merchantDomain || domain.endsWith(`.${merchantDomain}`);
  });
}

export function knownMerchantDomains(): string[] {
  return [...new Set(discoveryMerchants.map((merchant) => hostname(merchant.origin)).filter(Boolean))];
}

function normalizeCandidate(
  source: DiscoverySource,
  raw: { url?: unknown; title?: unknown; description?: unknown; content?: unknown },
): DiscoveryCandidate | null {
  const url = String(raw.url ?? "").trim();
  const domain = hostname(url);
  if (!url.startsWith("http") || !domain) return null;

  const merchant = merchantForUrl(url);
  return {
    source,
    url,
    title: String(raw.title ?? "").trim(),
    snippet: String(raw.description ?? raw.content ?? "").trim() || undefined,
    domain,
    merchantSlug: merchant?.slug,
    market: merchant?.market,
    deliveryToLatvia: merchant?.deliveryToLatvia,
  };
}

async function tavilySearch(query: string, options: DiscoveryOptions): Promise<DiscoveryResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not configured");

  const knownOnly = options.knownMerchantsOnly !== false;
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      topic: "general",
      // Keep Tavily permanently on the 1-credit basic search path unless this
      // constant is deliberately changed in code review.
      search_depth: TAVILY_SEARCH_DEPTH,
      max_results: Math.min(Math.max(options.maxResults ?? 20, 1), MAX_RESULTS_PER_DISCOVERY_CALL),
      include_answer: false,
      include_raw_content: false,
      ...(knownOnly ? { include_domains: knownMerchantDomains() } : {}),
      ...(options.country ? { country: options.country } : { country: "latvia" }),
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as { results?: Array<Record<string, unknown>> };
  const candidates = (payload.results ?? [])
    .map((item) => normalizeCandidate("tavily", item))
    .filter((item): item is DiscoveryCandidate => Boolean(item))
    .filter((item) => !knownOnly || Boolean(item.merchantSlug));

  return { source: "tavily", query, candidates };
}

async function braveSearch(query: string, options: DiscoveryOptions): Promise<DiscoveryResult> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY is not configured");

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(Math.max(options.maxResults ?? 20, 1), MAX_RESULTS_PER_DISCOVERY_CALL)),
    country: (options.country ?? "LV").toUpperCase(),
    search_lang: options.language ?? "lv",
  });

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      accept: "application/json",
      "x-subscription-token": apiKey,
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Brave search failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as {
    web?: { results?: Array<Record<string, unknown>> };
  };

  const knownOnly = options.knownMerchantsOnly === true;
  const candidates = (payload.web?.results ?? [])
    .map((item) => normalizeCandidate("brave", item))
    .filter((item): item is DiscoveryCandidate => Boolean(item))
    .filter((item) => !knownOnly || Boolean(item.merchantSlug));

  return { source: "brave", query, candidates };
}

/**
 * Discovery is for scheduled catalogue seeding / gap filling only.
 * User searches should query the CENIQ database, not call these providers.
 *
 * Known merchant discovery prefers Tavily because one request can target the
 * complete merchant-domain allowlist. Broad merchant discovery prefers Brave.
 */
export async function discoverProductUrls(
  query: string,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const knownOnly = options.knownMerchantsOnly !== false;

  if (knownOnly && process.env.TAVILY_API_KEY) {
    try {
      return await tavilySearch(query, { ...options, knownMerchantsOnly: true });
    } catch (error) {
      if (!process.env.BRAVE_SEARCH_API_KEY) throw error;
    }
  }

  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      return await braveSearch(query, options);
    } catch (error) {
      if (!process.env.TAVILY_API_KEY) throw error;
    }
  }

  if (process.env.TAVILY_API_KEY) {
    return tavilySearch(query, options);
  }

  throw new Error("No discovery provider configured. Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY.");
}
