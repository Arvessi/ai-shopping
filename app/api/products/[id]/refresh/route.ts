import { after, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { pollEnrichment, queueEnrichment } from '@/lib/canonical/enrichment';
import { refreshMerchantCoverage } from '@/lib/canonical/merchant-refresh';
export const maxDuration = 60;
export async function POST(_request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) {
    try {
        const { id } = await context.params;
        const alias = await prisma.productAlias.findUnique({ where: { alias: id } });
        const family = await prisma.productFamily.findUnique({ where: { id: alias?.familyId || id } });
        if (!family)
            return NextResponse.json({ error: 'Produkts nav atrasts.' }, { status: 404 });
        const recent = await prisma.enrichmentJob.findFirst({ where: { familyId: family.id, status: 'succeeded', finishedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } }, orderBy: { finishedAt: 'desc' } });
        if (recent)
            return NextResponse.json({ pending: false, status: 'succeeded', message: 'Piedāvājumi nesen pārbaudīti.' });
        const job = await queueEnrichment(family.canonicalTitle, family.id);
        const claim = await prisma.enrichmentJob.updateMany({ where: { id: job.id, status: 'queued' }, data: { status: 'running', providerStage: 'merchant-adapters', startedAt: new Date() } });
        if (claim.count)
            after(() => refreshMerchantCoverage(job.id, family.id, family.canonicalTitle));
        return NextResponse.json({ pending: true, status: 'running', stage: 'products', taskId: job.id });
    }
    catch {
        return NextResponse.json({ error: 'Veikalu meklēšanu neizdevās sākt.' }, { status: 502 });
    }
}
export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const jobId = params.get('jobId') || params.get('taskId');
    if (!jobId)
        return NextResponse.json({ error: 'Trūkst darba identifikatora.' }, { status: 400 });
    try {
        const job = await prisma.enrichmentJob.findUnique({ where: { id: jobId } });
        if (!job)
            return NextResponse.json({ error: 'Darbs nav atrasts.' }, { status: 404 });
        if (job.providerStage?.startsWith('merchant')) {
            const timedOut = job.status === 'running' && Date.now() - new Date(job.startedAt || job.createdAt).getTime() > 70000;
            if (timedOut)
                await prisma.enrichmentJob.update({ where: { id: jobId }, data: { status: 'timed_out', finishedAt: new Date(), lastError: 'Veikalu meklēšanas laiks beidzies.' } });
            const failed = timedOut || job.status === 'failed' || job.status === 'timed_out';
            return NextResponse.json({ pending: !failed && job.status === 'running', status: timedOut ? 'timed_out' : job.status, retryAfterMs: 1500, message: job.status === 'succeeded' ? job.lastError : undefined, error: failed ? job.lastError || 'Veikalu meklēšana neizdevās.' : undefined }, { status: failed ? 502 : 200 });
        }
        const result = await pollEnrichment(jobId);
        return NextResponse.json({ ...result, pending: result.status === 'queued' || result.status === 'running', taskId: jobId }, { status: result.status === 'failed' ? 502 : 200 });
    }
    catch {
        return NextResponse.json({ error: 'Neizdevās pārbaudīt meklēšanas statusu.' }, { status: 502 });
    }
}
