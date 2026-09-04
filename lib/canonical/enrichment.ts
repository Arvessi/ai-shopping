import { prisma } from '@/lib/db';
import { enrichmentLimitState, normalizeText } from './domain';
import { ingestCandidates, searchCanonicalCatalog } from './catalog';
import {
  createShoppingTask,
  getShoppingTask,
  mapShoppingCandidates,
} from './dataforseo-client';

const DEADLINE_MS = Math.min(
  180_000,
  Math.max(
    30_000,
    Number(process.env.ENRICHMENT_DEADLINE_MS || 90_000),
  ),
);

const MAX_ATTEMPTS = Math.min(
  20,
  Math.max(
    3,
    Number(process.env.ENRICHMENT_MAX_POLLS || 9),
  ),
);

export async function queueEnrichment(
  query: string,
  familyId?: string,
) {
  const normalizedQuery = normalizeText(query);

  const existing = await prisma.enrichmentJob.findFirst({
    where: {
      normalizedQuery,
      status: {
        in: ['queued', 'running'],
      },
      deadlineAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.enrichmentJob.create({
    data: {
      normalizedQuery,
      familyId,
      deadlineAt: new Date(
        Date.now() + DEADLINE_MS,
      ),
    },
  });
}

export async function startEnrichment(
  query: string,
  familyId?: string,
) {
  let job = await queueEnrichment(
    query,
    familyId,
  );

  if (job.status !== 'queued') {
    return job;
  }

  try {
    const providerTaskId =
      await createShoppingTask(query);

    job = await prisma.enrichmentJob.update({
      where: {
        id: job.id,
      },
      data: {
        status: 'running',
        startedAt: new Date(),
        providerStage: 'products',
        providerTaskId,
        providerTaskIds: [
          providerTaskId,
        ],
      },
    });
  } catch (error) {
    job = await prisma.enrichmentJob.update({
      where: {
        id: job.id,
      },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        lastError:
          error instanceof Error
            ? error.message
            : 'Provider task creation failed',
      },
    });
  }

  return job;
}

async function terminal(
  jobId: string,
  status: 'failed' | 'timed_out',
  error: string,
) {
  return prisma.enrichmentJob.update({
    where: {
      id: jobId,
    },
    data: {
      status,
      finishedAt: new Date(),
      lastError: error,
    },
  });
}

export async function pollEnrichment(
  jobId: string,
) {
  const job =
    await prisma.enrichmentJob.findUnique({
      where: {
        id: jobId,
      },
    });

  if (!job) {
    return {
      status: 'failed' as const,
      error:
        'Enrichment job not found.',
    };
  }

  if (job.status === 'succeeded') {
    return {
      status: job.status,
      results:
        await searchCanonicalCatalog(
          job.normalizedQuery,
        ),
    };
  }

  if (
    job.status === 'failed' ||
    job.status === 'timed_out'
  ) {
    return {
      status: job.status,
      error:
        job.lastError ||
        undefined,
    };
  }

  const limitState =
    enrichmentLimitState({
      deadlineAt: job.deadlineAt,
      attempts: job.attempts,
      maxAttempts: MAX_ATTEMPTS,
    });

  if (!limitState.allowed) {
    const ended = await terminal(
      job.id,
      'timed_out',
      'Enrichment exceeded its bounded deadline or poll limit.',
    );

    return {
      status: ended.status,
      error:
        ended.lastError ||
        undefined,
    };
  }

  if (
    job.status === 'queued' ||
    !job.providerTaskId
  ) {
    return {
      status: 'queued' as const,
      retryAfterMs: 500,
    };
  }

  const attempts =
    job.attempts + 1;

  await prisma.enrichmentJob.update({
    where: {
      id: job.id,
    },
    data: {
      attempts,
    },
  });

  try {
    const response =
      await getShoppingTask(
        job.providerTaskId,
      );

    if (
      response.state.state ===
      'pending'
    ) {
      return {
        status: 'running' as const,
        retryAfterMs: Math.min(
          8_000,
          750 *
            2 **
              Math.min(
                4,
                attempts - 1,
              ),
        ),
      };
    }

    if (
      response.state.state ===
      'failed'
    ) {
      const ended = await terminal(
        job.id,
        'failed',
        response.state.error ||
          'DataForSEO task failed.',
      );

      return {
        status: ended.status,
        error:
          ended.lastError ||
          undefined,
      };
    }

    const candidates =
      mapShoppingCandidates(
        response.json,
      );

    await ingestCandidates(
      candidates,
    );

    await prisma.enrichmentJob.update({
      where: {
        id: job.id,
      },
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        lastError: null,
      },
    });

    return {
      status: 'succeeded' as const,
      results:
        await searchCanonicalCatalog(
          job.normalizedQuery,
        ),
      ingested:
        candidates.length,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Enrichment polling failed.';

    const taskNotFound =
      /task not found/i.test(
        message,
      );

    if (taskNotFound) {
      const limits =
        enrichmentLimitState({
          deadlineAt:
            job.deadlineAt,
          attempts,
          maxAttempts:
            MAX_ATTEMPTS,
        });

      if (limits.allowed) {
        return {
          status:
            'running' as const,
          retryAfterMs:
            Math.min(
              8_000,
              1500 *
                Math.max(
                  1,
                  attempts,
                ),
            ),
          error:
            'provider_not_ready',
        };
      }

      const ended =
        await terminal(
          job.id,
          'timed_out',
          'Provider task was not available before the enrichment deadline.',
        );

      return {
        status: ended.status,
        error:
          ended.lastError ||
          undefined,
      };
    }

    const ended =
      attempts >=
      MAX_ATTEMPTS
        ? await terminal(
            job.id,
            'failed',
            message,
          )
        : null;

    if (ended) {
      return {
        status: ended.status,
        error:
          ended.lastError ||
          undefined,
      };
    }

    return {
      status:
        'running' as const,
      retryAfterMs:
        Math.min(
          8_000,
          1000 * attempts,
        ),
      error: message,
    };
  }
}