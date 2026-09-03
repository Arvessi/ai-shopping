import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        offers: { orderBy: [{ isBestOverall: 'desc' }, { totalPrice: 'asc' }] },
        snapshots: { orderBy: { recordedAt: 'asc' }, take: 180 },
      },
    });
    if (!product) return NextResponse.json({ error: 'Produkts nav atrasts.' }, { status: 404 });
    return NextResponse.json({ product });
  } catch {
    return NextResponse.json({ error: 'Produkta lapai nepieciešams konfigurēts DATABASE_URL.' }, { status: 500 });
  }
}
