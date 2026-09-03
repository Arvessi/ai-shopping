import { NextResponse } from 'next/server';
import { mapLiveProductSearch, searchProductsLive } from '@/lib/dataforseo';
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

    if (!q) return NextResponse.json({ error: 'Ievadi meklējamo produktu.' }, { status: 400 });
    if (isRestrictedShoppingQuery(q)) {
      return NextResponse.json({ error: 'Ceniq šo produktu kategoriju nemeklē.' }, { status: 400 });
    }

    if (databaseConfigured()) {
      const user = await getSessionUser();
      prisma.searchLog
        .create({ data: { query: q.slice(0, 700), mode, userId: user?.id } })
        .catch(() => undefined);
    }

    const raw = await searchProductsLive(q);
    const mapped = mapLiveProductSearch(raw);

    if (!mapped.length) {
      return NextResponse.json({
        results: [],
        source: 'dataforseo-live',
        message: 'Šim vaicājumam Google Shopping neatrada salīdzināmus produktus.',
      });
    }

    const results = await persistProducts(mapped);
    return NextResponse.json({ results, source: 'dataforseo-live' });
  } catch (error) {
    console.error('Ceniq search:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Meklēšana neizdevās.' },
      { status: 502 },
    );
  }
}

// Old clients used GET polling. Keep a clear response instead of silently hanging.
export async function GET() {
  return NextResponse.json(
    { error: 'Search polling is no longer used. Refresh the page and search again.' },
    { status: 410 },
  );
}
