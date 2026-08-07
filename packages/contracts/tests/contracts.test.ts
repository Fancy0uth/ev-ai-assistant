import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '../src/index';

describe('healthResponseSchema', () => {
  it('rejects a health response without a service version', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});
