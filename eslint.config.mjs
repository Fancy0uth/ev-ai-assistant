import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    settings: {
      next: {
        rootDir: 'apps/web',
      },
    },
  },
  globalIgnores([
    '.worktrees/**',
    '.superpowers/**',
    '.next/**',
    '**/.next/**',
    'dist/**',
    '**/dist/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
  ]),
]);
