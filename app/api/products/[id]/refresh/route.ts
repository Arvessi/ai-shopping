import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { pollEnrichment, startEnrichment } from '@/lib/canonical/enrichment';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const alias = await prisma.productAlias.findUnique({ where: { alias: id } });
  const family = await prisma.productFamily.findUnique({ where: { id: alias?.familyId || id } });
  if (!family) return NextResponse.json({ error: 'Produkts nav atrasts canonicalaja kataloga.' }, { status: 404 });
  const job = await startEnrichment(family.canonicalTitle, family.id);
  const pending = job.status === 'queued' || job.status === 'running';
  return NextResponse.json({ pending, status: job.status, stage: 'products', taskId: job.id, jobId: job.id, error: job.lastError || undefined }, { status: job.status === 'failed' ? 502 : 200 });
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get('jobId') || new URL(request.url).searchParams.get('taskId');
  if (!jobId) return NextResponse.json({ error: 'Trukst jobId.' }, { status: 400 });
  const result = await pollEnrichment(jobId);
  const pending = result.status === 'queued' || result.status === 'running';
  return NextResponse.json({ ...result, pending, stage: pending ? 'products' : 'done', taskId: jobId, jobId }, { status: result.status === 'failed' ? 502 : 200 });
}
