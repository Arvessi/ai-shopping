import { NextResponse } from 'next/server';
import { runCrawlerCycle } from '@/lib/crawler';
import { verifyCatalogSecret } from '@/lib/catalog';

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!verifyCatalogSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const result = await runCrawlerCycle(8);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Catalog crawler failed.' },
      { status: 500 },
    );
  }
}
