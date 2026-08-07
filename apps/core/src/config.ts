import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface CoreConfig {
  host: '127.0.0.1';
  port: number;
  dataDir: string;
  secureCookies: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const host = env.EV_CORE_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1') {
    throw new Error('EV_CORE_HOST must be 127.0.0.1');
  }

  const port = Number(env.EV_CORE_PORT ?? '4310');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('EV_CORE_PORT must be an integer between 1 and 65535');
  }

  const platformDataDir =
    process.platform === 'win32' && env.LOCALAPPDATA
      ? join(env.LOCALAPPDATA, 'EvAiAssistant')
      : join(homedir(), '.ev-ai-assistant');

  return {
    host,
    port,
    dataDir: resolve(env.EV_DATA_DIR ?? platformDataDir),
    secureCookies: env.EV_SECURE_COOKIES === 'true' || env.NODE_ENV === 'production',
  };
}
