import type { ZodType } from 'zod';
import { ApiError } from './api-error';

export function parseRequestInput<T>(
  schema: ZodType<T>,
  input: unknown,
  message: string,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError(422, 'VALIDATION_ERROR', message, {
      issues: result.error.issues.map(({ code, message: issueMessage, path }) => ({
        code,
        message: issueMessage,
        path,
      })),
    });
  }
  return result.data;
}
