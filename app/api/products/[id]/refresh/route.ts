import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSellersTask, getSellersTask, mapSellerOffers, taskPending } from '@/lib/dataforseo';
import { replaceOffers } from '@/lib/products';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: 'Produkts nav atrasts.' }, { status: 404 });
  try {
    const task = await createSellersTask({ productId: product.externalId.startsWith('pid:') ? product.externalId.slice(4) : undefined, gid: product.gid || undefined, dataDocId: product.dataDocId || undefined });
    return NextResponse.json({ pending: true, ...task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Neizdevās atjaunot piedāvājumus.' }, { status: 502 });
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const taskId = new URL(request.url).searchParams.get('taskId');
  if (!taskId) return NextResponse.json({ error: 'Trūkst taskId.' }, { status: 400 });
  try {
    const json = await getSellersTask(taskId);
    if (taskPending(json)) return NextResponse.json({ pending: true, taskId });
    const offers = mapSellerOffers(json);
    if (offers.length) await replaceOffers(id, offers);
    return NextResponse.json({ pending: false, offers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Piedāvājumu atjaunošana neizdevās.' }, { status: 502 });
  }
}
