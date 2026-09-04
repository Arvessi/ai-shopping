import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { databaseConfigured, prisma } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { searchCanonicalCatalog } from '@/lib/canonical/catalog';
import { queueEnrichment } from '@/lib/canonical/enrichment';

export const maxDuration = 10;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const q = String(body?.q || '').trim();
    const mode = body?.mode === 'assistant' ? 'assistant' : 'search';
    if (!q) return NextResponse.json({ error: 'Ievadi meklejamo produktu.' }, { status: 400 });
    if (isRestrictedShoppingQuery(q)) return NextResponse.json({ error: 'Ceniq so produktu kategoriju nemekle.' }, { status: 400 });
    if (!databaseConfigured()) return NextResponse.json({ error: 'CENIQ katalogam nav konfigureta datubaze.' }, { status: 503 });

    const user = await getSessionUser();
    prisma.searchLog.create({ data: { query: q.slice(0, 700), mode, userId: user?.id } }).catch(() => undefined);
    const results = await searchCanonicalCatalog(q);
    const bestCoverage = Math.max(0, ...results.map((product) => product.storesCount || 0));
    const bestVariants = Math.max(0, ...results.map((product) => product.catalogVariants?.length || 0));
    const needsEnrichment = !results.length || bestCoverage < 3 || bestVariants < 2;
    const job = needsEnrichment ? await queueEnrichment(q).catch(() => null) : null;

    return NextResponse.json({
      results, source: 'canonical-catalog', cached: true,
      enrichment: { enabled: Boolean(job), query: q, jobId: job?.id },
      message: !results.length ? 'Katalogs vel nav pietiekami bagats - CENIQ var palaist ierobezotu papildinasanu.' : undefined,
    });
  } catch (error) {
    console.error('CENIQ canonical search:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Meklesana neizdevas.' }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Search polling is not used; poll the bounded enrichment job.' }, { status: 410 });
}
