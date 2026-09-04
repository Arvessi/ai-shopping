import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCanonicalProduct } from '@/lib/canonical/catalog';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const preferredVariantId = new URL(request.url).searchParams.get('variantId') || undefined;
    const canonical = await getCanonicalProduct(id, preferredVariantId);
    if (canonical) {
      const selectedVariantId = canonical.selectedVariantId!;
      const [observations, job] = await Promise.all([
        prisma.offerObservation.findMany({
          where: { offer: { variantId: selectedVariantId, validationStatus: 'ACCEPTED', priceKind: 'ONE_TIME' }, totalPrice: { not: null } },
          orderBy: { observedAt: 'asc' }, take: 180,
        }),
        prisma.enrichmentJob.findFirst({ where: { familyId: canonical.id, status: 'succeeded' }, orderBy: { finishedAt: 'desc' } }),
      ]);
      return NextResponse.json({ product: {
        ...canonical, currentBestPrice: canonical.bestPrice, lastEnrichedAt: job?.finishedAt,
        snapshots: observations.map((row) => ({ id: row.id, price: row.totalPrice, recordedAt: row.observedAt })),
      } });
    }

    const legacy = await prisma.product.findUnique({ where: { id }, include: { offers: { orderBy: { totalPrice: 'asc' } }, snapshots: { orderBy: { recordedAt: 'asc' }, take: 180 } } });
    if (!legacy) return NextResponse.json({ error: 'Produkts nav atrasts.' }, { status: 404 });
    const alias = await prisma.productAlias.findUnique({ where: { alias: legacy.id } });
    if (alias) return NextResponse.redirect(new URL(`/api/products/${alias.familyId}`, request.url), 307);
    return NextResponse.json({ product: legacy, deprecated: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Produkta lapu neizdevas ieladet.' }, { status: 500 });
  }
}
