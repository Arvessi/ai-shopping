import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import crypto from 'node:crypto';

function applyAffiliateTemplate(rawUrl: string, subId: string) {
  const template = process.env.AFFILIATE_REDIRECT_TEMPLATE;
  if (!template) return rawUrl;
  return template.replaceAll('{url}', encodeURIComponent(rawUrl)).replaceAll('{subid}', encodeURIComponent(subId));
}

export async function GET(request: Request) {
  const offerId = new URL(request.url).searchParams.get('offerId');
  if (!offerId) return NextResponse.redirect(new URL('/', request.url));
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer?.rawUrl) return NextResponse.redirect(new URL('/', request.url));
  const subId = crypto.randomBytes(10).toString('hex');
  await prisma.affiliateClick.create({ data: { offerId, subId, userAgent: request.headers.get('user-agent'), referer: request.headers.get('referer') } }).catch(() => undefined);
  return NextResponse.redirect(applyAffiliateTemplate(offer.rawUrl, subId));
}
