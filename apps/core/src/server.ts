import { join } from 'node:path';
import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = await buildApp({
  databasePath: join(config.dataDir, 'app.sqlite'),
  artifactRoot: join(config.dataDir, 'artifacts'),
  memoryProjectionRoot: join(config.dataDir, 'memory'),
  logger: true,
  secureCookies: config.secureCookies,
  enableDailyPlanAutomation: true,
});
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.log.info({ signal }, 'Stopping Core service');
  await app.close();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ error }, 'Core service failed to start');
  process.exitCode = 1;
}
