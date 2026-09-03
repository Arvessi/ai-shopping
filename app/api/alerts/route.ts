import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jāielogojas.' }, { status: 401 });
  const alerts = await prisma.priceAlert.findMany({ where: { userId: user.id }, include: { product: true }, orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ alerts });
}
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jāielogojas.' }, { status: 401 });
  const body = await request.json();
  const productId = String(body?.productId || '');
  const targetPrice = Number(body?.targetPrice);
  if (!productId || !Number.isFinite(targetPrice) || targetPrice <= 0) return NextResponse.json({ error: 'Nederīgi brīdinājuma dati.' }, { status: 400 });
  const alert = await prisma.priceAlert.create({ data: { userId: user.id, productId, targetPrice, emailEnabled: body?.emailEnabled !== false, browserEnabled: body?.browserEnabled !== false } });
  return NextResponse.json({ alert });
}
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jāielogojas.' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Trūkst id.' }, { status: 400 });
  await prisma.priceAlert.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
