import { NextResponse } from 'next/server';
import { crawlerStatus, ensureCrawlerRegistry } from '@/lib/crawler';
import { STORE_COUNT } from '@/lib/store-registry';

export async function GET() {
  await ensureCrawlerRegistry();

  return NextResponse.json({
    configuredStores: STORE_COUNT,
    ...(await crawlerStatus()),
  });
}
