import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jāielogojas.' }, { status: 401 });
  const items = await prisma.wishlist.findMany({ where: { userId: user.id }, include: { product: { include: { offers: { orderBy: { totalPrice: 'asc' }, take: 3 } } } }, orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ items });
}
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jāielogojas.' }, { status: 401 });
  const { productId } = await request.json();
  if (!productId) return NextResponse.json({ error: 'Trūkst productId.' }, { status: 400 });
  await prisma.wishlist.upsert({ where: { userId_productId: { userId: user.id, productId } }, create: { userId: user.id, productId }, update: {} });
  return NextResponse.json({ ok: true });
}
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jāielogojas.' }, { status: 401 });
  const productId = new URL(request.url).searchParams.get('productId');
  if (!productId) return NextResponse.json({ error: 'Trūkst productId.' }, { status: 400 });
  await prisma.wishlist.deleteMany({ where: { userId: user.id, productId } });
  return NextResponse.json({ ok: true });
}
