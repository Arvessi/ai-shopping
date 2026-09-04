import { prisma } from '@/lib/db';
import { enrichmentLimitState, normalizeText } from './domain';
import { ingestCandidates, searchCanonicalCatalog } from './catalog';
import {
  createShoppingTask,
  getShoppingTask,
  isShoppingTaskReady,
  mapShoppingCandidates,
} from './dataforseo-client';

const DEADLINE_MS = Math.min(
  180_000,
  Math.max(30_000, Number(process.env.ENRICHMENT_DEADLINE_MS || 90_000)),
);

const MAX_ATTEMPTS = Math.min(
  20,
  Math.max(3, Number(process.env.ENRICHMENT_MAX_POLLS || 9)),
);

export async function queueEnrichment(query: string, familyId?: string) {
  const normalizedQuery = normalizeText(query);
  const existing = await prisma.enrichmentJob.findFirst({
    where: {
      normalizedQuery,
      status: { in: ['queued', 'running'] },
      deadlineAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.enrichmentJob.create({
    data: {
      normalizedQuery,
      familyId,
      deadlineAt: new Date(Date.now() + DEADLINE_MS),
    },
  });
}

export async function startEnrichment(query: string, familyId?: string) {
  let job = await queueEnrichment(query, familyId);
  if (job.status !== 'queued') return job;

  try {
    const providerTaskId = await createShoppingTask(query);
    job = await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: {
        status: 'running',
        startedAt: new Date(),
        providerStage: 'products_waiting',
        providerTaskId,
        providerTaskIds: [providerTaskId],
      },
    });
  } catch (error) {
    job = await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        lastError: error instanceof Error ? error.message : 'Provider task creation failed',
      },
    });
  }

  return job;
}

async function terminal(jobId: string, status: 'failed' | 'timed_out', error: string) {
  return prisma.enrichmentJob.update({
    where: { id: jobId },
    data: { status, finishedAt: new Date(), lastError: error },
  });
}

function retryDelay(attempts: number) {
  return Math.min(8_000, 1_000 * 2 ** Math.min(3, Math.max(0, attempts - 1)));
}

export async function pollEnrichment(jobId: string) {
  const job = await prisma.enrichmentJob.findUnique({ where: { id: jobId } });
  if (!job) return { status: 'failed' as const, error: 'Enrichment job not found.' };

  if (job.status === 'succeeded') {
    return { status: job.status, results: await searchCanonicalCatalog(job.normalizedQuery) };
  }
  if (job.status === 'failed' || job.status === 'timed_out') {
    return { status: job.status, error: job.lastError || undefined };
  }

  const limitState = enrichmentLimitState({
    deadlineAt: job.deadlineAt,
    attempts: job.attempts,
    maxAttempts: MAX_ATTEMPTS,
  });
  if (!limitState.allowed) {
    const ended = await terminal(job.id, 'timed_out', 'Enrichment exceeded its bounded deadline or poll limit.');
    return { status: ended.status, error: ended.lastError || undefined };
  }

  if (job.status === 'queued' || !job.providerTaskId) {
    return { status: 'queued' as const, retryAfterMs: 500 };
  }

  const attempts = job.attempts + 1;
  await prisma.enrichmentJob.update({
    where: { id: job.id },
    data: { attempts },
  });

  try {
    const ready = await isShoppingTaskReady(job.providerTaskId);
    if (!ready) {
      await prisma.enrichmentJob.update({
        where: { id: job.id },
        data: { providerStage: 'products_waiting', lastError: null },
      });
      return {
        status: 'running' as const,
        stage: 'provider_not_ready' as const,
        retryAfterMs: retryDelay(attempts),
      };
    }

    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: { providerStage: 'products_collecting', lastError: null },
    });

    const response = await getShoppingTask(job.providerTaskId);
    if (response.state.state === 'pending') {
      return {
        status: 'running' as const,
        stage: 'provider_not_ready' as const,
        retryAfterMs: retryDelay(attempts),
      };
    }
    if (response.state.state === 'failed') {
      const ended = await terminal(job.id, 'failed', response.state.error || 'DataForSEO task failed.');
      return { status: ended.status, error: ended.lastError || undefined };
    }

    const candidates = mapShoppingCandidates(response.json);
    await ingestCandidates(candidates);
    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: {
        status: 'succeeded',
        providerStage: 'done',
        finishedAt: new Date(),
        lastError: null,
      },
    });

    return {
      status: 'succeeded' as const,
      stage: 'succeeded' as const,
      results: await searchCanonicalCatalog(job.normalizedQuery),
      ingested: candidates.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Enrichment polling failed.';
    const limits = enrichmentLimitState({
      deadlineAt: job.deadlineAt,
      attempts,
      maxAttempts: MAX_ATTEMPTS,
    });

    if (/task not found/i.test(message) && limits.allowed) {
      return {
        status: 'running' as const,
        stage: 'provider_not_ready' as const,
        retryAfterMs: retryDelay(attempts),
      };
    }

    if (!limits.allowed) {
      const ended = await terminal(job.id, 'timed_out', message);
      return { status: ended.status, error: ended.lastError || undefined };
    }

    return {
      status: 'running' as const,
      stage: 'provider_retry' as const,
      retryAfterMs: retryDelay(attempts),
      error: message,
    };
  }
}
