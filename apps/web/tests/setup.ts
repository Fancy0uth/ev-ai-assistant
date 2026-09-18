import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

const testCsrfToken = 'A'.repeat(43);

beforeEach(() => {
  document.cookie = `ev_csrf=${testCsrfToken}; Path=/; SameSite=Strict`;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
