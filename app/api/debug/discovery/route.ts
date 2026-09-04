import { NextRequest, NextResponse } from "next/server";
import { discoverProductUrls, knownMerchantDomains } from "../../../../collector/discovery.ts";

const ALLOWED_QUERIES = new Set([
  "Sony WH-1000XM5",
  "MacBook Air M3",
  "LG OLED C4 55",
  "Canon EOS R50",
  "Epson EcoTank L3250",
  "Lenovo Legion 5",
]);

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!ALLOWED_QUERIES.has(q)) {
    return NextResponse.json(
      { error: "Query not allowed", allowedQueries: [...ALLOWED_QUERIES] },
      { status: 400 },
    );
  }

  const result = await discoverProductUrls(q, {
    knownMerchantsOnly: true,
    maxResults: 20,
    country: "latvia",
    language: "lv",
  });

  const merchants = [...new Set(result.candidates.map((c) => c.merchantSlug).filter(Boolean))];

  return NextResponse.json({
    query: q,
    provider: result.source,
    merchantUniverseSize: knownMerchantDomains().length,
    candidateCount: result.candidates.length,
    merchantCount: merchants.length,
    merchants,
    candidates: result.candidates.map((c) => ({
      merchantSlug: c.merchantSlug,
      domain: c.domain,
      title: c.title,
      url: c.url,
    })),
    creditSafety: {
      callsThisRequest: 1,
      maxResults: 20,
      note: "This endpoint allows only one whitelisted benchmark query per request.",
    },
  });
}
