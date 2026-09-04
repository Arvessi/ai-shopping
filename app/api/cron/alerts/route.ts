import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { prisma } from '@/lib/db';

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

  const fresh = await prisma.priceAlert.findMany({ where: { active: true }, include: { product: true, family: true, variant: true, user: true }, take: 50 });
  let triggered = 0;
  for (const alert of fresh) {
    const canonicalPrice = alert.familyId
      ? (await prisma.merchantOffer.aggregate({
          where: {
            variant: alert.variantId ? { id: alert.variantId } : { familyId: alert.familyId },
            validationStatus: 'ACCEPTED', priceKind: 'ONE_TIME', totalPrice: { not: null },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          _min: { totalPrice: true },
        }))._min.totalPrice
      : null;
    const price = canonicalPrice ?? alert.product?.currentBestPrice;
    if (price == null || price > alert.targetPrice) continue;
    const recently = alert.lastTriggeredAt && Date.now() - alert.lastTriggeredAt.getTime() < 1000 * 60 * 60 * 24 * 3;
    if (recently) continue;
    const title = alert.family?.canonicalTitle || alert.product?.title || 'CENIQ produkts';
    const productId = alert.familyId || alert.productId || '';
    if (alert.emailEnabled) await sendEmail(alert.user.email, title, price, alert.targetPrice, productId).catch(console.error);
    if (alert.browserEnabled) await sendPush(alert.userId, title, price, productId).catch(console.error);
    await prisma.priceAlert.update({ where: { id: alert.id }, data: { lastTriggeredAt: new Date() } });
    triggered += 1;
  }
  return NextResponse.json({ ok: true, checked: fresh.length, refreshed: 0, triggered });
}
