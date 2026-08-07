import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/modules/auth/password';

describe('password hashing', () => {
  it('verifies the original password and rejects a different password', async () => {
    const encoded = await hashPassword('correct horse battery staple');

    expect(encoded).toMatch(/^scrypt\$16384\$8\$1\$/);
    await expect(verifyPassword('correct horse battery staple', encoded)).resolves.toBe(true);
    await expect(verifyPassword('different password value', encoded)).resolves.toBe(false);
  });

  it('rejects a malformed stored hash without throwing', async () => {
    await expect(verifyPassword('correct horse battery staple', 'malformed')).resolves.toBe(false);
  });
});
