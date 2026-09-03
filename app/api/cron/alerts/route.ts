import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { prisma } from '@/lib/db';
import { createSellersTask, getSellersTask, mapSellerOffers, taskPending } from '@/lib/dataforseo';
import { replaceOffers } from '@/lib/products';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function refreshProduct(product: { id: string; externalId: string; gid: string | null; dataDocId: string | null }) {
  try {
    const task = await createSellersTask({ productId: product.externalId.startsWith('pid:') ? product.externalId.slice(4) : undefined, gid: product.gid || undefined, dataDocId: product.dataDocId || undefined });
    for (let i = 0; i < 5; i += 1) {
      await sleep(1200);
      const json = await getSellersTask(task.taskId);
      if (taskPending(json)) continue;
      const offers = mapSellerOffers(json);
      if (offers.length) await replaceOffers(product.id, offers);
      break;
    }
  } catch (error) {
    console.error('alert refresh', product.id, error);
  }
}

async function sendEmail(to: string, title: string, price: number, target: number, productId: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;
  if (!key || !from) return;
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://ceniq.lv';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Ceniq: ${title} sasniedza tavu cenu`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>Cena nokritusies 🎉</h2><p><strong>${title}</strong> pašreizējā labākā cena ir <strong>€${price.toFixed(2)}</strong>.</p><p>Tavs slieksnis: €${target.toFixed(2)}</p><p><a href="${base}/product/${productId}">Apskatīt piedāvājumus Ceniq</a></p></div>`
    })
  });
}

async function sendPush(userId: string, title: string, price: number, productId: string) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@ceniq.lv', publicKey, privateKey);
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  const payload = JSON.stringify({ title: 'Ceniq cenu brīdinājums', body: `${title}: €${price.toFixed(2)}`, url: `/product/${productId}` });
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => undefined);
    }
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const active = await prisma.priceAlert.findMany({ where: { active: true }, include: { product: true, user: true }, take: 50 });
  const products = Array.from(new Map<string, { id: string; externalId: string; gid: string | null; dataDocId: string | null }>(active.map((a: any) => [a.productId, a.product])).values()).slice(0, 10);
  for (const product of products) await refreshProduct(product);

  const fresh = await prisma.priceAlert.findMany({ where: { active: true }, include: { product: true, user: true }, take: 50 });
  let triggered = 0;
  for (const alert of fresh) {
    const price = alert.product.currentBestPrice;
    if (price == null || price > alert.targetPrice) continue;
    const recently = alert.lastTriggeredAt && Date.now() - alert.lastTriggeredAt.getTime() < 1000 * 60 * 60 * 24 * 3;
    if (recently) continue;
    if (alert.emailEnabled) await sendEmail(alert.user.email, alert.product.title, price, alert.targetPrice, alert.productId).catch(console.error);
    if (alert.browserEnabled) await sendPush(alert.userId, alert.product.title, price, alert.productId).catch(console.error);
    await prisma.priceAlert.update({ where: { id: alert.id }, data: { lastTriggeredAt: new Date() } });
    triggered += 1;
  }
  return NextResponse.json({ ok: true, checked: fresh.length, refreshed: products.length, triggered });
}
