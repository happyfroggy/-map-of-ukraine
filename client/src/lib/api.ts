import { adminTokenStore } from './storage.ts';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Send the admin bearer token. */
  admin?: boolean;
}

export async function api<T>(path: string, { method = 'GET', body, admin = false }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (admin) {
    const token = adminTokenStore.get();
    if (token) headers.authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('Немає з’єднання з сервером', 0);
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    if (admin && res.status === 401) adminTokenStore.set(null);
    throw new ApiError(data?.error ?? `Помилка ${res.status}`, res.status);
  }
  return data as T;
}
