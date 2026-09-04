import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { pollEnrichment, startEnrichment } from '@/lib/canonical/enrichment';

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const jobs = await prisma.enrichmentJob.findMany({
    where: { status: { in: ['queued', 'running'] } }, orderBy: { createdAt: 'asc' }, take: 8,
  });
  const results = await Promise.all(jobs.map(async (job) => {
    if (job.deadlineAt <= new Date()) {
      const expired = await pollEnrichment(job.id);
      return { id: job.id, status: expired.status };
    }
    if (job.status === 'queued') {
      const started = await startEnrichment(job.normalizedQuery, job.familyId || undefined);
      return { id: job.id, status: started.status };
    }
    const result = await pollEnrichment(job.id);
    return { id: job.id, status: result.status };
  }));
  return NextResponse.json({ ok: true, processed: results.length, jobs: results });
}
