import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Jāielogojas.' }, { status: 401 });
  const sub = await request.json();
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: 'Nederīgs push subscription.' }, { status: 400 });
  await prisma.pushSubscription.upsert({ where: { endpoint }, create: { userId: user.id, endpoint, p256dh, auth }, update: { userId: user.id, p256dh, auth } });
  return NextResponse.json({ ok: true });
}
