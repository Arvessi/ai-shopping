import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { databaseConfigured, prisma } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { ingestCandidates, searchCanonicalCatalog } from '@/lib/canonical/catalog';
import { queueEnrichment } from '@/lib/canonical/enrichment';
import {
  discoverShoppingLive,
  mapShoppingCandidates,
} from '@/lib/canonical/dataforseo-client';

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const q = String(body?.q || '').trim();
    const mode = body?.mode === 'assistant' ? 'assistant' : 'search';

    if (!q) {
      return NextResponse.json(
        { error: 'Ievadi meklejamo produktu.' },
        { status: 400 },
      );
    }

    if (isRestrictedShoppingQuery(q)) {
      return NextResponse.json(
        { error: 'Ceniq so produktu kategoriju nemekle.' },
        { status: 400 },
      );
    }

    if (!databaseConfigured()) {
      return NextResponse.json(
        { error: 'CENIQ katalogam nav konfigureta datubaze.' },
        { status: 503 },
      );
    }

    const user = await getSessionUser();
    prisma.searchLog
      .create({
        data: {
          query: q.slice(0, 700),
          mode,
          userId: user?.id,
        },
      })
      .catch(() => undefined);

    let results = await searchCanonicalCatalog(q);
    let source = 'canonical-catalog';
    let liveCandidateCount = 0;

    // The canonical catalog stays the source of truth, but an empty catalog must
    // not mean an empty user experience. Use DataForSEO's synchronous Live SERP
    // request as an immediate fallback, ingest what we can validate, then query
    // the canonical catalog again. The slower Merchant task remains background
    // enrichment only.
    if (!results.length) {
      try {
        const liveJson = await discoverShoppingLive(q);
        const liveCandidates = mapShoppingCandidates(liveJson);
        liveCandidateCount = liveCandidates.length;

        if (liveCandidates.length) {
          await ingestCandidates(liveCandidates);
          results = await searchCanonicalCatalog(q);
          if (results.length) source = 'canonical-live';
        }
      } catch (liveError) {
        console.error('CENIQ live shopping fallback:', liveError);
      }
    }

    const bestCoverage = Math.max(
      0,
      ...results.map((product) => product.storesCount || 0),
    );
    const bestVariants = Math.max(
      0,
      ...results.map((product) => product.catalogVariants?.length || 0),
    );
    const needsEnrichment =
      !results.length || bestCoverage < 3 || bestVariants < 2;
    const job = needsEnrichment
      ? await queueEnrichment(q).catch(() => null)
      : null;

    return NextResponse.json({
      results,
      source,
      cached: source === 'canonical-catalog',
      liveCandidateCount,
      enrichment: {
        enabled: Boolean(job),
        query: q,
        jobId: job?.id,
      },
      message: !results.length
        ? 'CENIQ neatrada derigus veikalu piedavajumus siem meklesanas vardiem.'
        : undefined,
    });
  } catch (error) {
    console.error('CENIQ canonical search:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Meklesana neizdevas.',
      },
      { status: 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Search polling is not used; poll the bounded enrichment job.' },
    { status: 410 },
  );
}
