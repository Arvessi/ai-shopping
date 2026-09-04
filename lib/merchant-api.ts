const API_BASE = 'https://api.dataforseo.com/v3';

type Json = Record<string, any>;

function authHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    throw new Error('DataForSEO credentials are not configured.');
  }

  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      json?.status_message ||
        `DataForSEO request failed (${response.status}).`,
    );
  }

  if (
    typeof json?.status_code === 'number' &&
    json.status_code >= 40000
  ) {
    throw new Error(
      json?.status_message ||
        `DataForSEO request failed (${json.status_code}).`,
    );
  }

  return json as Json;
}

function locationTask() {
  return {
    location_name: process.env.DATAFORSEO_LOCATION_NAME || 'Latvia',
    language_code: process.env.DATAFORSEO_LANGUAGE_CODE || 'en',
  };
}

function merchantPriority() {
  const value = Number(process.env.DATAFORSEO_MERCHANT_PRIORITY || 1);
  return value === 2 ? 2 : 1;
}

export async function createMerchantProductsTask(keyword: string) {
  const json = await request('/merchant/google/products/task_post', {
    method: 'POST',
    body: JSON.stringify([
      {
        ...locationTask(),
        keyword,
        priority: merchantPriority(),
        depth: 40,
      },
    ]),
  });

  const task = json?.tasks?.[0];

  if (!task?.id) {
    throw new Error(
      task?.status_message ||
        'DataForSEO did not create a Google Shopping Products task.',
    );
  }

  return {
    taskId: String(task.id),
    statusCode: task.status_code,
    statusMessage: task.status_message,
  };
}

export async function getMerchantProductsTask(taskId: string) {
  return request(
    `/merchant/google/products/task_get/advanced/${encodeURIComponent(taskId)}`,
  );
}

export async function createMerchantProductInfoTask(ids: {
  productId?: string;
  gid?: string;
  dataDocId?: string;
}) {
  const identity =
    ids.productId || ids.gid || ids.dataDocId
      ? {
          ...(ids.productId ? { product_id: ids.productId } : {}),
          ...(ids.gid ? { gid: ids.gid } : {}),
          ...(ids.dataDocId ? { data_docid: ids.dataDocId } : {}),
        }
      : null;

  if (!identity) {
    throw new Error('Product has no Google Shopping identity.');
  }

  const json = await request('/merchant/google/product_info/task_post', {
    method: 'POST',
    body: JSON.stringify([
      {
        ...locationTask(),
        priority: merchantPriority(),
        ...identity,
      },
    ]),
  });

  const task = json?.tasks?.[0];

  if (!task?.id) {
    throw new Error(
      task?.status_message ||
        'DataForSEO did not create a Product Info task.',
    );
  }

  return {
    taskId: String(task.id),
    statusCode: task.status_code,
    statusMessage: task.status_message,
  };
}

export async function getMerchantProductInfoTask(taskId: string) {
  return request(
    `/merchant/google/product_info/task_get/advanced/${encodeURIComponent(
      taskId,
    )}`,
  );
}

export function merchantTaskPending(json: Json) {
  const task = json?.tasks?.[0];

  if (!task) return true;

  return (
    task.status_code === 40601 ||
    task.status_code === 40602 ||
    !Array.isArray(task.result)
  );
}
