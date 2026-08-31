import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthTextProvider, ProviderKey } from '@ev/contracts';
import { ApiError, registerErrorHandling } from './http/api-error';
import { createAgentRepository } from './modules/agent/repository';
import { registerAgentRoutes } from './modules/agent/routes';
import { createAgentService } from './modules/agent/service';
import { createAuthRepository } from './modules/auth/repository';
import { registerAuthRoutes } from './modules/auth/routes';
import { createAuthService } from './modules/auth/service';
import { createCalendarRepository } from './modules/calendar/repository';
import { registerCalendarRoutes } from './modules/calendar/routes';
import { createCalendarService } from './modules/calendar/service';
import { registerCourseImportRoutes } from './modules/calendar/import-routes';
import { createCourseImportService } from './modules/calendar/import-service';
import { registerDayPlanningRoutes } from './modules/day-planning/routes';
import { createDayPlanningService } from './modules/day-planning/service';
import { registerHealthRoutes } from './modules/health/routes';
import { registerFitnessRoutes } from './modules/fitness/routes';
import { createFitnessRepository } from './modules/fitness/repository';
import { createFitnessService } from './modules/fitness/service';
import { createV07IdempotencyService } from './modules/health-loop/idempotency-service';
import { createV07HealthLoopRepository } from './modules/health-loop/repository';
import { registerHealthLoopRoutes } from './modules/health-loop/routes';
import { registerLearningRoutes } from './modules/learning/routes';
import { createLearningService } from './modules/learning/service';
import { createDeepSeekLearningAdviceCapability } from './modules/learning/deepseek-learning-advice';
import { createPublicResourceFetcher, type PublicResourceFetcher } from './modules/learning/public-resource-fetcher';
import { registerMemoryRoutes } from './modules/memory/routes';
import { createMemoryService } from './modules/memory/service';
import { registerProjectScopeRoutes } from './modules/projects/routes';
import { createProjectScopeService } from './modules/projects/scope-service';
import { createProposalRepository } from './modules/proposals/repository';
import { registerProposalRoutes } from './modules/proposals/routes';
import { createProposalService } from './modules/proposals/service';
import { registerNutritionRoutes } from './modules/nutrition/routes';
import { createNutritionService } from './modules/nutrition/service';
import type { NutritionDataProvider } from './modules/nutrition/provider';
import { registerProviderRoutes } from './modules/providers/routes';
import { createProviderService } from './modules/providers/service';
import { createProviderCredentialService } from './modules/providers/credential-service';
import { createIdempotencyService } from './modules/providers/idempotency-service';
import type { DeepSeekConnectionTester } from './modules/providers/deepseek-connection';
import { createProviderReliabilityRepository } from './modules/providers/reliability-repository';
import { createWindowsDpapiSecretStore, type SecretStorePort } from './modules/providers/secret-store';
import { createTaskRepository } from './modules/tasks/repository';
import { registerTaskRoutes } from './modules/tasks/routes';
import { createTaskService } from './modules/tasks/service';
import { createTaskSchedulingUnitOfWork } from './modules/tasks/task-scheduling-unit-of-work';
import { registerTodayRoutes } from './modules/today/routes';
import { openDatabase } from './storage/database';
import type { AgentProvider } from './modules/agent/provider';
import type { DomainAgentProvider } from './modules/agents/provider';
import {
  createCapabilityRegistry,
  type LearningAdviceCapability,
  type LearningAdviceCapabilityFactory,
  type PublicSearchCapability,
  type VisionCapability,
} from './modules/providers/capabilities';
import { createCapabilityRunRepository } from './modules/providers/capability-run-repository';
import { createDailyPlanningContextService } from './modules/daily-planning/context-service';
import { createDailyPlanAutomationService } from './modules/daily-planning/automation-service';
import { createDeepSeekDailyPlanningProvider } from './modules/daily-planning/deepseek-provider';
import type { DailyPlanningProvider } from './modules/daily-planning/provider';
import { createDailyPlanRunRepository } from './modules/daily-planning/repository';
import { createDailyPlanReviewService } from './modules/daily-planning/review-service';
import { createDailyPlanPreflightService } from './modules/daily-planning/preflight-service';
import { createDailyPlanningService } from './modules/daily-planning/service';
import {
  createDailyPlanExecutionUnitOfWork,
  type DailyPlanTerminalFaultCheckpoint,
} from './modules/daily-planning/execution-unit-of-work';
import { registerDailyPlanningRoutes } from './routes/daily-planning';

export interface AppOptions {
  agentProvider?: AgentProvider;
  artifactRoot?: string;
  visionCapability?: VisionCapability;
  publicSearchCapability?: PublicSearchCapability;
  publicResourceFetcher?: PublicResourceFetcher;
  learningAdviceCapability?: LearningAdviceCapability;
  learningAdviceCapabilityFactory?: LearningAdviceCapabilityFactory;
  courseImportExternalOperationObserver?: (inTransaction: boolean) => void;
  learningExternalOperationObserver?: (inTransaction: boolean, operation?: 'LEARNING_CREDENTIAL_UNPROTECT' | 'LEARNING_ADVICE_GENERATE') => void;
  domainAgentProvider?: DomainAgentProvider;
  domainAgentProviders?: Partial<Record<ProviderKey, DomainAgentProvider>>;
  secretStore?: SecretStorePort;
  deepSeekConnectionTester?: DeepSeekConnectionTester;
  dailyPlanningProvider?: DailyPlanningProvider;
  dailyPlanTerminalFault?: (checkpoint: DailyPlanTerminalFaultCheckpoint) => void;
  databasePath?: string;
  memoryProjectionRoot?: string;
  enableDailyPlanAutomation?: boolean;
  dailyPlanAutomationNow?: () => Date;
  providerReliabilityNow?: () => Date;
  logger?: boolean;
  secureCookies?: boolean;
  healthTextProvider?: HealthTextProvider;
  nutritionDataProvider?: NutritionDataProvider;
  v07TestAdapterGate?: { nodeEnv: 'test'; enabled: true; runnerDataRoot: string };
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
  });
  const databasePath = options.databasePath ?? ':memory:';
  const fixtureRequested = options.healthTextProvider?.descriptor.adapterKind === 'TEST_FIXTURE' || options.nutritionDataProvider?.descriptor.adapterKind === 'TEST_FIXTURE';
  if (fixtureRequested) {
    const gate = options.v07TestAdapterGate;
    const root = gate ? resolve(gate.runnerDataRoot) : '';
    const pathInsideRoot = databasePath !== ':memory:' && root !== '' && !relative(root, resolve(databasePath)).startsWith('..');
    if (process.env.NODE_ENV !== 'test' || !gate || gate.nodeEnv !== 'test' || !gate.enabled || !pathInsideRoot) {
      throw new Error('V07_TEST_FIXTURE_GATE_REJECTED');
    }
  }
  const database = openDatabase(databasePath);
  const dataRoot = databasePath === ':memory:' ? join(tmpdir(), 'ev-ai-assistant') : dirname(databasePath);
  const artifactRoot = options.artifactRoot ?? join(dataRoot, 'artifacts');
  const explicitLearningAdviceCapability = options.learningAdviceCapability?.descriptor.adapterKind === 'TEST_FAKE'
    ? options.learningAdviceCapability
    : undefined;
  const capabilityRegistry = createCapabilityRegistry({
    dataRoot,
    ...(options.visionCapability ? { vision: options.visionCapability } : {}),
    ...(options.publicSearchCapability ? { publicSearch: options.publicSearchCapability } : {}),
    ...(explicitLearningAdviceCapability ? { learningAdvice: explicitLearningAdviceCapability } : {}),
  });
  const capabilityRunRepository = createCapabilityRunRepository(database);
  capabilityRunRepository.sweepExpired((options.providerReliabilityNow ?? (() => new Date()))().toISOString());

  registerErrorHandling(app);
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new ApiError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试'),
  });
  app.decorateRequest('owner', null);
  const authRepository = createAuthRepository(database);
  const authService = await createAuthService(authRepository);
  const agentService = createAgentService(
    createAgentRepository(database),
    options.agentProvider ? { provider: options.agentProvider } : {},
  );
  const taskRepository = createTaskRepository(database);
  const calendarRepository = createCalendarRepository(database);
  const fitnessRepository = createFitnessRepository(database);
  const healthLoopRepository = createV07HealthLoopRepository(database);
  const v07IdempotencyService = createV07IdempotencyService({
    database,
    repository: healthLoopRepository,
  });
  const proposalRepository = createProposalRepository(database);
  const proposalService = createProposalService(proposalRepository, calendarRepository, { database });
  const calendarService = createCalendarService(calendarRepository, proposalService);
  const taskService = createTaskService(taskRepository, {
    schedulingUnitOfWork: createTaskSchedulingUnitOfWork(database, {
      taskRepository,
      calendarRepository,
      newId: () => crypto.randomUUID(),
      now: () => new Date(),
    }),
  });
  const fitnessService = createFitnessService(
    fitnessRepository,
    calendarRepository,
    healthLoopRepository,
    v07IdempotencyService,
    ...(options.healthTextProvider ? [{ healthTextProvider: options.healthTextProvider }] : []),
  );
  const providerCredentialService = createProviderCredentialService(
    database,
    options.secretStore ?? createWindowsDpapiSecretStore(),
    options.deepSeekConnectionTester ? { connectionTester: options.deepSeekConnectionTester } : {},
  );
  const learningAdviceCapabilityFactory = explicitLearningAdviceCapability
    ? undefined
    : options.learningAdviceCapabilityFactory ?? {
        descriptor: { providerId: 'deepseek', providerLabel: 'DeepSeek 文本学习建议', adapterKind: 'PRODUCTION_ADAPTER' as const },
        create(apiKey: string) { return createDeepSeekLearningAdviceCapability({ apiKey }); },
      };
  const learningService = createLearningService(database, calendarRepository, {
    capabilityRegistry,
    capabilityRuns: capabilityRunRepository,
    proposalService,
    publicResourceFetcher: options.publicResourceFetcher ?? createPublicResourceFetcher(),
    credentialService: providerCredentialService,
    ...(learningAdviceCapabilityFactory ? { learningAdviceCapabilityFactory } : {}),
    ...(options.learningExternalOperationObserver ? { onExternalOperation: options.learningExternalOperationObserver } : {}),
  });
  const dayPlanningService = createDayPlanningService(
    calendarRepository,
    taskService,
    proposalService,
  );
  const courseImportService = createCourseImportService(
    database,
    calendarRepository,
    artifactRoot,
    capabilityRegistry,
    options.courseImportExternalOperationObserver ? { onExternalOperation: options.courseImportExternalOperationObserver } : {},
  );
  const artifactDeleteRecovery = await courseImportService.recoverPendingArtifactDeletes();
  for (const failure of artifactDeleteRecovery.failures) {
    app.log.warn({ artifactId: failure.artifactId, ownerId: failure.ownerId, err: failure.error }, 'course artifact deletion recovery failed');
  }
  const providerService = createProviderService(database, {
    providers: {
      ...(options.domainAgentProvider ? { [options.domainAgentProvider.key]: options.domainAgentProvider } : {}),
      ...options.domainAgentProviders,
    },
  });
  const providerReliabilityRepository = createProviderReliabilityRepository(database);
  const dailyPlanRepository = createDailyPlanRunRepository(database);
  const dailyPlanExecutionUnitOfWork = createDailyPlanExecutionUnitOfWork({
    database,
    dailyPlanRepository,
    reliabilityRepository: providerReliabilityRepository,
    ...(options.dailyPlanTerminalFault ? { fault: options.dailyPlanTerminalFault } : {}),
  });
  const reliabilityNow = options.providerReliabilityNow ?? (() => new Date());
  try {
    dailyPlanExecutionUnitOfWork.sweepExpired(reliabilityNow().toISOString());
  } catch (error) {
    database.close();
    throw error;
  }
  const idempotencyService = createIdempotencyService({
    database,
    repository: providerReliabilityRepository,
    now: reliabilityNow,
    terminalizeExpiredExecution(record, nowIso) {
      return dailyPlanExecutionUnitOfWork.terminalizeExpired(record, nowIso);
    },
  });
  const dailyPlanningContextService = createDailyPlanningContextService(dailyPlanRepository, {
    newId: () => crypto.randomUUID(),
  });
  const dailyPlanPreflightService = createDailyPlanPreflightService({
    contextService: dailyPlanningContextService,
    repository: dailyPlanRepository,
    newId: () => crypto.randomUUID(),
    ...(options.providerReliabilityNow ? { now: options.providerReliabilityNow } : {}),
  });
  const dailyPlanReviewService = createDailyPlanReviewService({
    repository: dailyPlanRepository,
    newId: () => crypto.randomUUID(),
  });
  const dailyPlanningService = createDailyPlanningService({
    preflightService: dailyPlanPreflightService,
    repository: dailyPlanRepository,
    credentialService: providerCredentialService,
    provider: options.dailyPlanningProvider ?? createDeepSeekDailyPlanningProvider(),
    reliabilityRepository: providerReliabilityRepository,
    executionUnitOfWork: dailyPlanExecutionUnitOfWork,
    newId: () => crypto.randomUUID(),
    ...(options.providerReliabilityNow ? { now: options.providerReliabilityNow } : {}),
  });
  const dailyPlanAutomationService = createDailyPlanAutomationService({
    dailyPlanPreflightService,
    dailyPlanRunRepository: dailyPlanRepository,
    findOwnerId: () => authRepository.findOwnerId(),
    ...(options.dailyPlanAutomationNow ? { now: options.dailyPlanAutomationNow } : {}),
    onEvent(event) {
      app.log.warn(event, 'daily plan automation failed');
    },
  });
  const nutritionService = createNutritionService(database, {
    healthLoopRepository,
    v07IdempotencyService,
    ...(options.healthTextProvider ? { healthTextProvider: options.healthTextProvider } : {}),
    ...(options.nutritionDataProvider ? { nutritionDataProvider: options.nutritionDataProvider } : {}),
  });
  const memoryService = createMemoryService(
    database,
    options.memoryProjectionRoot ?? (databasePath === ':memory:' ? join(tmpdir(), 'ev-ai-assistant-memory') : join(dirname(databasePath), 'memory')),
  );
  const projectScopeService = createProjectScopeService(database);
  if (options.enableDailyPlanAutomation) dailyPlanAutomationService.scheduleNextRun();
  app.addHook('onClose', async () => {
    dailyPlanAutomationService.stop();
    if (database.open) database.close();
  });
  await registerHealthRoutes(app, database);
  await registerHealthLoopRoutes(app, { ...(options.healthTextProvider ? { healthTextProvider: options.healthTextProvider } : {}), ...(options.nutritionDataProvider ? { nutritionDataProvider: options.nutritionDataProvider } : {}) });
  await registerAuthRoutes(app, {
    authService,
    secureCookies: options.secureCookies ?? false,
  });
  await registerAgentRoutes(app, {
    authService,
    agentService,
    ...(options.agentProvider ? { agentProvider: options.agentProvider } : {}),
  });
  await registerTaskRoutes(app, { authService, taskService });
  await registerCalendarRoutes(app, { authService, calendarService });
  await registerCourseImportRoutes(app, { authService, courseImportService });
  await registerFitnessRoutes(app, { authService, fitnessService });
  await registerNutritionRoutes(app, { authService, nutritionService });
  await registerLearningRoutes(app, { authService, learningService });
  await registerMemoryRoutes(app, { authService, memoryService });
  await registerProjectScopeRoutes(app, { authService, projectScopeService });
  await registerProposalRoutes(app, { authService, proposalService, idempotencyService });
  await registerProviderRoutes(app, { authService, providerService, providerCredentialService, capabilityRegistry });
  await registerDailyPlanningRoutes(app, {
    authService,
    dailyPlanningService,
    dailyPlanPreflightService,
    dailyPlanReviewService,
    idempotencyService,
  });
  await registerDayPlanningRoutes(app, { authService, dayPlanningService });
  await registerTodayRoutes(app, {
    authService,
    taskService,
    calendarRepository,
    proposalService,
    dailyPlanReviewService,
    providerCredentialService,
    dailyPlanRepository,
    dailyPlanAutomationService,
    learningService,
  });

  return app;
}
