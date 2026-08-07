import { describe, expect, it } from 'vitest';
import { credentialsSchema, healthResponseSchema } from '../src/index';

describe('healthResponseSchema', () => {
  it('rejects a health response without a service version', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});

describe('credentialsSchema', () => {
  it('rejects passwords shorter than twelve characters', () => {
    expect(
      credentialsSchema.safeParse({ username: 'codex', password: 'too-short' }).success,
    ).toBe(false);
  });

  it('accepts Unicode letters in a local owner username', () => {
    expect(
      credentialsSchema.safeParse({
        username: '本地主人',
        password: 'correct horse battery staple',
      }).success,
    ).toBe(true);
  });
});
