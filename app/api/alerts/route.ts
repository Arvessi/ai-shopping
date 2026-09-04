import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getCanonicalProduct } from '@/lib/canonical/catalog';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jaielogojas.' }, { status: 401 });
  const rows = await prisma.priceAlert.findMany({ where: { userId: user.id }, include: { product: true, family: true, variant: true }, orderBy: { createdAt: 'desc' } });
  const alerts = await Promise.all(rows.map(async (row) => {
    const canonical = row.familyId ? await getCanonicalProduct(row.familyId) : null;
    return { ...row, productId: row.familyId || row.productId, product: canonical ? { ...canonical, currentBestPrice: canonical.bestPrice } : row.product };
  }));
  return NextResponse.json({ alerts });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jaielogojas.' }, { status: 401 });
  const body = await request.json();
  const familyId = body?.familyId ? String(body.familyId) : null;
  const variantId = body?.variantId ? String(body.variantId) : null;
  const productId = body?.productId ? String(body.productId) : null;
  const targetPrice = Number(body?.targetPrice);
  if ((!familyId && !productId) || !Number.isFinite(targetPrice) || targetPrice <= 0) return NextResponse.json({ error: 'Nederigi bridinajuma dati.' }, { status: 400 });
  const alert = await prisma.priceAlert.create({ data: { userId: user.id, familyId, variantId, productId, targetPrice, emailEnabled: body?.emailEnabled !== false, browserEnabled: body?.browserEnabled !== false } });
  return NextResponse.json({ alert });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jaielogojas.' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Trukst id.' }, { status: 400 });
  await prisma.priceAlert.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
