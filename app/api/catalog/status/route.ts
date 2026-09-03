import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  verifyCatalogSecret,
} from '@/lib/catalog';

export async function GET(
  request: Request,
) {
  if (!verifyCatalogSecret(request)) {
    return NextResponse.json(
      { error: 'Unauthorized.' },
      { status: 401 },
    );
  }

  const [
    merchants,
    sources,
    families,
    variants,
    activeOffers,
    lastRuns,
  ] = await Promise.all([
    prisma.merchant.count({
      where: { active: true },
    }),
    prisma.feedSource.count({
      where: { active: true },
    }),
    prisma.catalogFamily.count({
      where: { active: true },
    }),
    prisma.catalogVariant.count({
      where: { active: true },
    }),
    prisma.catalogOffer.count({
      where: { active: true },
    }),
    prisma.importRun.findMany({
      orderBy: {
        startedAt: 'desc',
      },
      take: 10,
      include: {
        source: {
          select: {
            slug: true,
            name: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    merchants,
    sources,
    families,
    variants,
    activeOffers,
    lastRuns,
  });
}
