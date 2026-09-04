import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getCanonicalProduct } from '@/lib/canonical/catalog';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jaielogojas.' }, { status: 401 });
  const rows = await prisma.wishlist.findMany({
    where: { userId: user.id }, include: { product: { include: { offers: { orderBy: { totalPrice: 'asc' }, take: 3 } } }, family: true, variant: true }, orderBy: { createdAt: 'desc' },
  });
  const items = await Promise.all(rows.map(async (row) => {
    const canonical = row.familyId ? await getCanonicalProduct(row.familyId) : null;
    return { ...row, productId: row.familyId || row.productId, product: canonical ? { ...canonical, currentBestPrice: canonical.bestPrice } : row.product };
  }));
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jaielogojas.' }, { status: 401 });
  const body = await request.json();
  const familyId = body?.familyId ? String(body.familyId) : null;
  const variantId = body?.variantId ? String(body.variantId) : null;
  const productId = body?.productId ? String(body.productId) : null;
  if (!familyId && !productId) return NextResponse.json({ error: 'Trukst produkta identifikatora.' }, { status: 400 });
  const existing = await prisma.wishlist.findFirst({ where: { userId: user.id, ...(familyId ? { familyId, variantId } : { productId }) } });
  if (!existing) await prisma.wishlist.create({ data: { userId: user.id, familyId, variantId, productId } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jaielogojas.' }, { status: 401 });
  const url = new URL(request.url);
  const familyId = url.searchParams.get('familyId');
  const productId = url.searchParams.get('productId');
  if (!familyId && !productId) return NextResponse.json({ error: 'Trukst produkta identifikatora.' }, { status: 400 });
  await prisma.wishlist.deleteMany({ where: { userId: user.id, ...(familyId ? { familyId } : { OR: [{ productId }, { familyId: productId }] }) } });
  return NextResponse.json({ ok: true });
}
