import { NextResponse } from 'next/server';
import { databaseConfigured } from '@/lib/db';
import { isRestrictedShoppingQuery } from '@/lib/safety';
import { pollEnrichment, startEnrichment } from '@/lib/canonical/enrichment';

export const maxDuration = 20;

export async function POST(request: Request) {
  try {
    if (!databaseConfigured()) return NextResponse.json({ error: 'Datubaze nav konfigureta.' }, { status: 503 });
    const body = await request.json();
    const q = String(body?.q || '').trim();
    if (!q || isRestrictedShoppingQuery(q)) return NextResponse.json({ error: 'Nederiga meklesanas fraze.' }, { status: 400 });
    const job = await startEnrichment(q, body?.familyId ? String(body.familyId) : undefined);
    const terminal = job.status === 'failed' || job.status === 'timed_out';
    return NextResponse.json({
      pending: !terminal && job.status !== 'succeeded', status: job.status, stage: job.providerStage || 'queued',
      taskId: job.id, jobId: job.id, query: q, error: job.lastError || undefined,
    }, { status: terminal ? 502 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Neizdevas sakt kataloga papildinasanu.' }, { status: 502 });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const jobId = String(url.searchParams.get('jobId') || url.searchParams.get('taskId') || '');
    if (!jobId) return NextResponse.json({ error: 'Trukst jobId.' }, { status: 400 });
    const result = await pollEnrichment(jobId);
    const pending = result.status === 'queued' || result.status === 'running';
    return NextResponse.json({ ...result, pending, stage: pending ? 'products' : 'done', taskId: jobId, jobId }, { status: result.status === 'failed' ? 502 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Kataloga papildinasana neizdevas.', pending: false, status: 'failed' }, { status: 502 });
  }
}
