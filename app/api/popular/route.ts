import { NextResponse } from 'next/server';
import { databaseConfigured, prisma } from '@/lib/db';

const fallback = ['iPhone 17 Pro', 'gaming monitors 240Hz', 'OLED TV 55', 'MacBook Air', 'wireless headphones'];

export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ searches: fallback });
  try {
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
    const rows = await prisma.searchLog.groupBy({ by: ['query'], where: { createdAt: { gte: since } }, _count: { query: true }, orderBy: { _count: { query: 'desc' } }, take: 8 });
    return NextResponse.json({ searches: rows.length ? rows.map((r: { query: string }) => r.query) : fallback });
  } catch {
    return NextResponse.json({ searches: fallback });
  }
}
