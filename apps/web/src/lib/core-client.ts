import { apiErrorSchema } from '@ev/contracts';

export class CoreClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'CoreClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function requestCore(path: string, init: RequestInit): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  let response: Response;
  try {
    response = await fetch(`/api/core/${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new CoreClientError(
      0,
      'CORE_UNAVAILABLE',
      '本地 Core 暂时不可用，请确认服务已启动',
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload);
    if (parsedError.success) {
      throw new CoreClientError(
        response.status,
        parsedError.data.error.code,
        parsedError.data.error.message,
        parsedError.data.error.details,
      );
    }
    throw new CoreClientError(response.status, 'UNEXPECTED_RESPONSE', '请求未能完成，请稍后重试');
  }
  return payload;
}
