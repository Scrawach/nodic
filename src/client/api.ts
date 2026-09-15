import { get, update } from 'idb-keyval';
import { checkRemoved } from './project-events';

type Creation = { id: string; path: string; body: string; tab: string };
function currentTab() {
  let id = sessionStorage.getItem('nodic-tab');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('nodic-tab', id);
  }
  return id;
}
const queueKey = 'nodic-http-creations-v1';
const inFlight = new Map<string, Promise<unknown>>();
const isCreation = (path: string) =>
  /^\/dialogues\/[^/]+\/nodes$/.test(path) ||
  /^\/projects\/[^/]+\/(dialogues|characters)$/.test(path);

async function request<T>(path: string, body?: string, operationId?: string): Promise<T> {
  const response = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined
        ? undefined
        : {
            'Content-Type': 'application/json',
            ...(operationId ? { 'Idempotency-Key': operationId } : {}),
          },
    body,
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.message || 'Не удалось выполнить запрос.');
    Object.assign(error, { status: response.status });
    throw error;
  }
  return result;
}

async function remove(id: string) {
  await update<Creation[]>(queueKey, (items = []) => items.filter((item) => item.id !== id));
}

function deliver(item: Creation): Promise<unknown> {
  const existing = inFlight.get(item.id);
  if (existing) return existing;
  const promise = (async () => {
    try {
      let result: unknown;
      try {
        result = await request(item.path, item.body, item.id);
      } catch (error) {
        if (error instanceof Error && 'status' in error) throw error;
        result = await request(item.path, item.body, item.id);
      }
      await remove(item.id);
      return result;
    } catch (error) {
      if (
        error instanceof Error &&
        'status' in error &&
        typeof error.status === 'number' &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 401 &&
        error.status !== 403 &&
        error.status !== 429
      ) {
        await remove(item.id);
      }
      throw error;
    }
  })();
  inFlight.set(item.id, promise);
  void promise.finally(() => inFlight.delete(item.id)).catch(() => {});
  return promise;
}

export async function recoverCreations(path: string) {
  const pending = (await get<Creation[]>(queueKey)) || [];
  for (const item of pending.filter(
    (entry) => entry.tab === currentTab() && entry.path.startsWith(path + '/'),
  )) {
    await deliver(item);
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (body !== undefined && isCreation(path)) {
    const encoded = JSON.stringify(body);
    let item: Creation = { id: crypto.randomUUID(), path, body: encoded, tab: currentTab() };
    // Persist before sending; reuse an unresolved identical intent after a lost response.
    await update<Creation[]>(queueKey, (items = []) => {
      const previous = items.find(
        (entry) => entry.tab === item.tab && entry.path === path && entry.body === encoded,
      );
      if (previous) {
        item = previous;
        return items;
      }
      return [...items, item];
    });
    return (await deliver(item)) as T;
  }
  if (body === undefined && /^\/(projects|dialogues)\/[^/]+$/.test(path)) {
    if (await checkRemoved(path.startsWith('/dialogues/') ? path.split('/')[2] : undefined))
      throw new Error('Объект удалён владельцем.');
    await recoverCreations(path);
  }
  return request<T>(path, body === undefined ? undefined : JSON.stringify(body));
}
