import { join } from 'node:path';
import type { AppOptions } from './app';
import { buildApp } from './app';
import { loadConfig, type CoreConfig } from './config';
import { createWikipediaPublicSearchCapability } from './modules/learning/wikipedia-search';

interface StartableCoreApp {
  log: {
    info(bindings: { signal: string }, message: string): unknown;
  };
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<void>;
}

type CoreAppBuilder = (options: AppOptions) => Promise<StartableCoreApp>;

export interface CoreStartupOverrides {
  loadConfig?: () => CoreConfig;
  buildApp?: CoreAppBuilder;
  writeStderr?: (notice: string) => void;
  setExitCode?: (code: number) => void;
  registerSignal?: (signal: NodeJS.Signals, listener: () => void) => void;
}

const STARTUP_FAILURE_NOTICE = 'EV_CORE_STARTUP_FAILED\n';
const SHUTDOWN_FAILURE_NOTICE = 'EV_CORE_SHUTDOWN_FAILED\n';

function writeFixedStderr(writeStderr: (notice: string) => void, notice: string): void {
  try {
    writeStderr(notice);
  } catch {
    // A fallback failure must never become an unhandled startup exception.
  }
}

function markFailed(setExitCode: (code: number) => void): void {
  try {
    setExitCode(1);
  } catch {
    // The fixed stderr notice is the only allowed failure detail.
  }
}

export async function startCore(overrides: CoreStartupOverrides = {}): Promise<void> {
  const readConfig = overrides.loadConfig ?? loadConfig;
  const createApp = overrides.buildApp ?? buildApp;
  const writeStderr = overrides.writeStderr ?? ((notice: string): void => {
    process.stderr.write(notice);
  });
  const setExitCode = overrides.setExitCode ?? ((code: number): void => {
    process.exitCode = code;
  });
  const registerSignal = overrides.registerSignal ?? ((signal: NodeJS.Signals, listener: () => void): void => {
    process.once(signal, listener);
  });
  let app: StartableCoreApp | undefined;
  let isShuttingDown = false;

  async function closeApp(): Promise<void> {
    const appToClose = app;
    app = undefined;
    if (appToClose) await appToClose.close();
  }

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    try {
      app?.log.info({ signal }, 'Stopping Core service');
    } catch {
      // Runtime logging has its own fixed safe degradation path.
    }
    try {
      await closeApp();
    } catch {
      writeFixedStderr(writeStderr, SHUTDOWN_FAILURE_NOTICE);
      markFailed(setExitCode);
    }
  }

  try {
    const config = readConfig();
    const runtimeLogRoot = process.env.EV_LOG_DIR;
    app = await createApp({
      databasePath: join(config.dataDir, 'app.sqlite'),
      artifactRoot: join(config.dataDir, 'artifacts'),
      memoryProjectionRoot: join(config.dataDir, 'memory'),
      logger: true,
      ...(runtimeLogRoot !== undefined ? { runtimeLogRoot } : {}),
      secureCookies: config.secureCookies,
      enableDailyPlanAutomation: true,
      publicSearchCapability: createWikipediaPublicSearchCapability(),
    });
    await app.listen({ host: config.host, port: config.port });
    registerSignal('SIGINT', () => {
      void shutdown('SIGINT');
    });
    registerSignal('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
  } catch {
    try {
      await closeApp();
    } catch {
      // Startup failures emit only the fixed notice below.
    }
    writeFixedStderr(writeStderr, STARTUP_FAILURE_NOTICE);
    markFailed(setExitCode);
  }
}

if (process.env.NODE_ENV !== 'test') {
  void startCore();
}
