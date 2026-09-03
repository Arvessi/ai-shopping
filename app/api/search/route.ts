import { NextResponse } from 'next/server';
import { mapFastProductSearch, searchProductsFast } from '@/lib/dataforseo';
import { persistProducts } from '@/lib/products';
import { getSessionUser } from '@/lib/auth';
import { databaseConfigured, prisma } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const q = String(body?.q || '').trim();
    const mode = body?.mode === 'assistant' ? 'assistant' : 'search';

    if (!q) {
      return NextResponse.json({ error: 'Ievadi meklējamo produktu.' }, { status: 400 });
    }

    if (isRestrictedShoppingQuery(q)) {
      return NextResponse.json({ error: 'Ceniq šo produktu kategoriju nemeklē.' }, { status: 400 });
    }

    if (databaseConfigured()) {
      const user = await getSessionUser();
      prisma.searchLog
        .create({ data: { query: q.slice(0, 700), mode, userId: user?.id } })
        .catch(() => undefined);
    }

    // First try ordinary Google SERP: product queries often expose a Shopping or
    // Popular Products block and this is the fastest DataForSEO path.
    let raw = await searchProductsFast(q, false);
    let mapped = mapFastProductSearch(raw);

    // If Google did not show a product block, retry once with the new Shopping
    // markup. This is still a Live request — no task queue or polling spinner.
    if (!mapped.length) {
      raw = await searchProductsFast(q, true);
      mapped = mapFastProductSearch(raw);
    }

    if (!mapped.length) {
      return NextResponse.json({
        results: [],
        source: 'dataforseo-serp-live',
        message: 'Google šim vaicājumam neatgrieza produktu cenas. Pamēģini precīzāku modeļa nosaukumu.',
      });
    }

    const results = await persistProducts(mapped);
    return NextResponse.json({ results, source: 'dataforseo-serp-live' });
  } catch (error) {
    console.error('Ceniq search:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Meklēšana neizdevās.' },
      { status: 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Search polling is no longer used.' }, { status: 410 });
}
