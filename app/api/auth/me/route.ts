import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ user: null });
  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, email: true, name: true, createdAt: true } });
  return NextResponse.json({ user });
}
