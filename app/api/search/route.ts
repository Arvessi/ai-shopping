import { NextResponse } from 'next/server';
import { createProductSearchTask, getProductSearchTask, mapProductSearch, taskPending } from '@/lib/dataforseo';
import { persistProducts } from '@/lib/products';
import { getSessionUser } from '@/lib/auth';
import { databaseConfigured, prisma } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const q = String(body?.q || '').trim();
    const mode = body?.mode === 'assistant' ? 'assistant' : 'search';
    if (!q) return NextResponse.json({ error: 'Ievadi meklējamo produktu.' }, { status: 400 });
    if (isRestrictedShoppingQuery(q)) return NextResponse.json({ error: 'Ceniq šo produktu kategoriju nemeklē.' }, { status: 400 });

    if (databaseConfigured()) {
      const user = await getSessionUser();
      prisma.searchLog.create({ data: { query: q.slice(0, 700), mode, userId: user?.id } }).catch(() => undefined);
    }
    const task = await createProductSearchTask(q);
    return NextResponse.json({ pending: true, ...task });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Meklēšanu neizdevās sākt.' }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get('taskId')?.trim();
  if (!taskId) return NextResponse.json({ error: 'Trūkst taskId.' }, { status: 400 });
  try {
    const json = await getProductSearchTask(taskId);
    if (taskPending(json)) return NextResponse.json({ pending: true, taskId });
    const mapped = mapProductSearch(json);
    const results = await persistProducts(mapped);
    return NextResponse.json({ pending: false, taskId, results, source: 'dataforseo' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Meklēšana neizdevās.' }, { status: 502 });
  }
}
