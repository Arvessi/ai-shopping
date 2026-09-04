import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  createMerchantProductInfoTask,
  createMerchantProductsTask,
  getMerchantProductInfoTask,
  getMerchantProductsTask,
  merchantTaskPending,
} from '@/lib/merchant-api';
import {
  bestIdentity,
  familyQuery,
  mapMerchantProductsTask,
  mapProductInfoTask,
  persistMarketProducts,
  searchMarketCatalog,
} from '@/lib/merchant-engine';

export const maxDuration = 20;

function taskCacheKey(query: string) {
  return `merchant35-task:${query
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()}`;
}

async function getExistingTask(query: string) {
  const row = await prisma.searchCache
    .findUnique({
      where: { key: taskCacheKey(query) },
    })
    .catch(() => null);

  if (!row || row.expiresAt <= new Date()) return null;

  const data = row.results as any;

  if (!data?.taskId || !data?.stage) return null;

  return {
    taskId: String(data.taskId),
    stage: String(data.stage),
  };
}

async function saveTask(
  query: string,
  taskId: string,
  stage: string,
) {
  const expiresAt = new Date(
    Date.now() + 15 * 60 * 1000,
  );

  await prisma.searchCache.upsert({
    where: { key: taskCacheKey(query) },
    create: {
      key: taskCacheKey(query),
      query,
      results: {
        taskId,
        stage,
      },
      expiresAt,
    },
    update: {
      query,
      results: {
        taskId,
        stage,
      },
      expiresAt,
    },
  });
}

async function clearTask(query: string) {
  await prisma.searchCache
    .delete({
      where: { key: taskCacheKey(query) },
    })
    .catch(() => undefined);
}

async function writeSearchCache(
  originalQuery: string,
  results: unknown,
) {
  const key = `v35:${originalQuery
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()}`;

  await prisma.searchCache
    .upsert({
      where: { key },
      create: {
        key,
        query: originalQuery,
        results: JSON.parse(JSON.stringify(results)),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      },
      update: {
        query: originalQuery,
        results: JSON.parse(JSON.stringify(results)),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      },
    })
    .catch(() => undefined);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const originalQuery = String(body?.q || '').trim();

    if (!originalQuery) {
      return NextResponse.json(
        { error: 'Trūkst meklēšanas frāzes.' },
        { status: 400 },
      );
    }

    const query = familyQuery(originalQuery);

    const existing = await getExistingTask(query);

    if (existing) {
      return NextResponse.json({
        pending: true,
        stage: existing.stage,
        taskId: existing.taskId,
        query,
      });
    }

    const task = await createMerchantProductsTask(query);

    await saveTask(query, task.taskId, 'products');

    return NextResponse.json({
      pending: true,
      stage: 'products',
      taskId: task.taskId,
      query,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Neizdevās sākt Google Shopping kataloga paplašināšanu.',
      },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const taskId = String(url.searchParams.get('taskId') || '');
    const stage = String(url.searchParams.get('stage') || 'products');
    const originalQuery = String(url.searchParams.get('q') || '').trim();

    if (!taskId || !originalQuery) {
      return NextResponse.json(
        { error: 'Trūkst taskId vai q.' },
        { status: 400 },
      );
    }

    const query = familyQuery(originalQuery);

    if (stage === 'products') {
      const json = await getMerchantProductsTask(taskId);

      if (merchantTaskPending(json)) {
        return NextResponse.json({
          pending: true,
          stage: 'products',
          taskId,
        });
      }

      const mapped = mapMerchantProductsTask(json, query);

      if (mapped.length) {
        await persistMarketProducts(mapped);
      }

      const partialResults = await searchMarketCatalog(originalQuery);

      const identity = bestIdentity(mapped);

      if (identity) {
        try {
          const infoTask = await createMerchantProductInfoTask(identity);

          await saveTask(query, infoTask.taskId, 'info');

          return NextResponse.json({
            pending: true,
            stage: 'info',
            taskId: infoTask.taskId,
            results: partialResults,
            source: 'google-shopping-products',
          });
        } catch {
          // Products result is still useful even if Product Info task fails.
        }
      }

      await clearTask(query);
      await writeSearchCache(originalQuery, partialResults);

      return NextResponse.json({
        pending: false,
        stage: 'done',
        results: partialResults,
        source: 'google-shopping-products',
      });
    }

    const json = await getMerchantProductInfoTask(taskId);

    if (merchantTaskPending(json)) {
      return NextResponse.json({
        pending: true,
        stage: 'info',
        taskId,
      });
    }

    const mapped = mapProductInfoTask(json, query);

    if (mapped.length) {
      await persistMarketProducts(mapped);
    }

    const results = await searchMarketCatalog(originalQuery);

    await clearTask(query);
    await writeSearchCache(originalQuery, results);

    return NextResponse.json({
      pending: false,
      stage: 'done',
      results,
      source: 'google-shopping-product-info',
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Google Shopping kataloga paplašināšana neizdevās.',
      },
      { status: 502 },
    );
  }
}
