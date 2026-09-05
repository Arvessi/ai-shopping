import { NextRequest, NextResponse } from "next/server";
import { discoverProductUrls, knownMerchantDomains } from "../../../../collector/discovery.ts";

const SMOKE_QUERY = "Sony WH-1000XM5";
const SMOKE_NONCE = "ceniq-smoke-20260904-a7f3";
const EXPIRES_AT = Date.parse("2026-09-04T13:40:00Z");

export async function GET(request: NextRequest) {
  // Temporary one-shot smoke gate. It accepts one exact benchmark query plus
  // an unguessable nonce and self-expires quickly. No arbitrary provider calls.
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const once = request.nextUrl.searchParams.get("once") ?? "";
  if (Date.now() > EXPIRES_AT || q !== SMOKE_QUERY || once !== SMOKE_NONCE) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
      mode: "basic",
    },
  });
}
