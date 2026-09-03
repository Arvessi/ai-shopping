import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { setSession } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const name = String(body?.name || '').trim().slice(0, 80) || null;
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: 'Nederīga e-pasta adrese.' }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: 'Parolei jābūt vismaz 8 rakstzīmes garai.' }, { status: 400 });
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return NextResponse.json({ error: 'Konts ar šo e-pastu jau eksistē.' }, { status: 409 });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, passwordHash, name } });
    await setSession(user);
    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Reģistrācija neizdevās. Pārbaudi DATABASE_URL.' }, { status: 500 });
  }
}
