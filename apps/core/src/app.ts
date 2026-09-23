import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  healthTextProviderDescriptorSchema,
  nutritionDataProviderDescriptorSchema,
  type BackupHealthSnapshot,
  type HealthTextProvider,
  type ProviderKey,
} from '@ev/contracts';
import { ApiError, registerErrorHandling } from './http/api-error';
import type { WorkoutPlanningProvider } from '@ev/domain';
import { createDeepSeekWorkoutPlanningProvider } from './modules/fitness/deepseek-workout-planning';
import { createWorkoutPlanningService } from './modules/fitness/planning-service';
import { registerFitnessPlanningRoutes } from './modules/fitness/planning-routes';
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
import { createDeepSeekCourseVisionResolver } from './modules/calendar/deepseek-course-vision';
import { createEventLanguageService } from './modules/calendar/event-language';
import { registerEventLanguageRoutes } from './modules/calendar/event-language-routes';
import { createNutritionCredentialService } from './modules/nutrition/credential-service';
import { registerNutritionCredentialRoutes } from './modules/nutrition/credential-routes';
import { createUsdaNutritionResolver } from './modules/nutrition/usda-resolver';
import { createDeepSeekWebNutritionResolver } from './modules/nutrition/deepseek-web-nutrition';
import { registerDayPlanningRoutes } from './modules/day-planning/routes';
import { createDayPlanningService } from './modules/day-planning/service';
import { registerHealthRoutes } from './modules/health/routes';
import { registerFitnessRoutes } from './modules/fitness/routes';
import { createFitnessRepository } from './modules/fitness/repository';
import { createFitnessService } from './modules/fitness/service';
import { createV07IdempotencyService } from './modules/health-loop/idempotency-service';
import { createV07HealthLoopRepository } from './modules/health-loop/repository';
import { registerHealthLoopRoutes } from './modules/health-loop/routes';
import { createDeepSeekHealthTextResolver } from './modules/health-loop/deepseek-health-text';
import { registerLearningRoutes } from './modules/learning/routes';
import { createLearningService } from './modules/learning/service';
import { createDeepSeekLearningAdviceCapability } from './modules/learning/deepseek-learning-advice';
import { createPublicResourceFetcher, type PublicResourceFetcher } from './modules/learning/public-resource-fetcher';
import { createWikipediaResourceFetcher } from './modules/learning/wikipedia-resource-fetcher';
import { registerMemoryRoutes } from './modules/memory/routes';
import { registerMemoryCompactionRoutes } from './modules/memory/compaction-routes';
import { createMemoryCompactionService } from './modules/memory/compaction-service';
import { registerEntityMemoryRoutes } from './modules/memory/entity-routes';
import { createEntityMemoryService } from './modules/memory/entity-service';
import { createMemoryService } from './modules/memory/service';
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
import { createDailyPlanCoordinationService } from './modules/daily-planning/coordination-service';
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
import { isPathInsideRoot } from './filesystem/path-containment';
import { createRuntimeLogger, safeRuntimeLogSerializers, type RuntimeLogger } from './observability/runtime-logger';

export interface AppOptions {
  workoutPlanningProvider?: WorkoutPlanningProvider;
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
  runtimeLogRoot?: string;
  runtimeLogger?: RuntimeLogger;
  readBackupHealthSnapshot?: () => BackupHealthSnapshot | undefined;
  secureCookies?: boolean;
  healthTextProvider?: HealthTextProvider;
  nutritionDataProvider?: NutritionDataProvider;
  v07TestAdapterGate?: { nodeEnv: 'test'; enabled: true; runnerDataRoot: string };
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  let healthTextDescriptor: HealthTextProvider['descriptor'] | undefined;
  let nutritionDataDescriptor: NutritionDataProvider['descriptor'] | undefined;
  let workoutPlanningDescriptor: WorkoutPlanningProvider['descriptor'] | undefined;
  try {
    workoutPlanningDescriptor = options.workoutPlanningProvider
      ? healthTextProviderDescriptorSchema.parse(options.workoutPlanningProvider.descriptor)
      : undefined;
    healthTextDescriptor = options.healthTextProvider
      ? healthTextProviderDescriptorSchema.parse(options.healthTextProvider.descriptor)
      : undefined;
    nutritionDataDescriptor = options.nutritionDataProvider
      ? nutritionDataProviderDescriptorSchema.parse(options.nutritionDataProvider.descriptor)
      : undefined;
  } catch {
    throw new Error('V07_PROVIDER_DESCRIPTOR_REJECTED');
  }
  const runtimeLogger = options.logger === false
    ? undefined
    : options.runtimeLogger ?? createRuntimeLogger({
      ...(options.runtimeLogRoot !== undefined ? { logRoot: options.runtimeLogRoot } : {}),
    });
  const app = Fastify({
    logger: runtimeLogger
      ? { level: 'info', stream: runtimeLogger.stream, serializers: safeRuntimeLogSerializers }
      : false,
    genReqId: () => crypto.randomUUID(),
  });
  const databasePath = options.databasePath ?? ':memory:';
  const dataRoot = databasePath === ':memory:' ? join(tmpdir(), 'ev-ai-assistant') : dirname(databasePath);
  const artifactRoot = options.artifactRoot ?? join(dataRoot, 'artifacts');
  const fixtureRequested = healthTextDescriptor?.adapterKind === 'TEST_FIXTURE'
    || nutritionDataDescriptor?.adapterKind === 'TEST_FIXTURE'
    || workoutPlanningDescriptor?.adapterKind === 'TEST_FIXTURE';
  if (fixtureRequested) {
    const gate = options.v07TestAdapterGate;
    const pathsInsideRunnerRoot = gate
      && databasePath !== ':memory:'
      && [databasePath, dataRoot, artifactRoot].every((path) => isPathInsideRoot(gate.runnerDataRoot, path));
    if (process.env.NODE_ENV !== 'test' || !gate || gate.nodeEnv !== 'test' || !gate.enabled || !pathsInsideRunnerRoot) {
      throw new Error('V07_TEST_FIXTURE_GATE_REJECTED');
    }
  }
  const database = openDatabase(databasePath);
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
    nutritionMatchLeaseMs: 70_000,
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
  const providerCredentialService = createProviderCredentialService(
    database,
    options.secretStore ?? createWindowsDpapiSecretStore(),
    options.deepSeekConnectionTester ? { connectionTester: options.deepSeekConnectionTester } : {},
  );
  const healthTextProviderForOwner = createDeepSeekHealthTextResolver(providerCredentialService);
  const visionCapabilityForOwner = createDeepSeekCourseVisionResolver(providerCredentialService);
  const eventLanguageService = createEventLanguageService(calendarRepository, providerCredentialService);
  const nutritionCredentials = createNutritionCredentialService(database, options.secretStore ?? createWindowsDpapiSecretStore());
  const usdaNutritionForOwner = createUsdaNutritionResolver(nutritionCredentials);
  const webNutritionForOwner = createDeepSeekWebNutritionResolver(database, providerCredentialService);
  const nutritionDataProviderForOwner = (ownerId: string) => usdaNutritionForOwner(ownerId) ?? webNutritionForOwner(ownerId);
  const fitnessService = createFitnessService(
    fitnessRepository, calendarRepository, healthLoopRepository, v07IdempotencyService,
    { healthTextProviderForOwner, ...(options.healthTextProvider ? { healthTextProvider: options.healthTextProvider } : {}) },
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
    publicResourceFetcher: options.publicResourceFetcher ?? createWikipediaResourceFetcher(createPublicResourceFetcher()),
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
    { visionCapabilityForOwner, ...(options.courseImportExternalOperationObserver ? { onExternalOperation: options.courseImportExternalOperationObserver } : {}) },
  );
  const artifactDeleteRecovery = await courseImportService.recoverPendingArtifactDeletes();
  for (const failure of artifactDeleteRecovery.failures) {
    app.log.warn({ artifactId: failure.artifactId, ownerId: failure.ownerId, err: failure.error }, 'course artifact deletion recovery failed');
  }
  const providerService = createProviderService(database, {
    providers: {
      ...(options.domainAgentProvider?.key === 'DEEPSEEK'
        ? { DEEPSEEK: options.domainAgentProvider }
        : {}),
      ...(options.domainAgentProviders?.DEEPSEEK
        ? { DEEPSEEK: options.domainAgentProviders.DEEPSEEK }
        : {}),
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
  const dailyPlanCoordinationService = createDailyPlanCoordinationService({
    contextService: dailyPlanningContextService,
    repository: dailyPlanRepository,
    newId: () => crypto.randomUUID(),
    ...(options.providerReliabilityNow ? { now: options.providerReliabilityNow } : {}),
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
    prepareLocalProposal: database.transaction((ownerId: string, localDate: string, trigger: import('@ev/contracts').DailyPlanTrigger) => {
      if (!dailyPlanRepository.findLatestRunForDate(ownerId, localDate)) {
        dailyPlanCoordinationService.coordinateLocalRules(ownerId, localDate, trigger);
      }
    }),
    dailyPlanRunRepository: dailyPlanRepository,
    findOwnerId: () => authRepository.findOwnerId(),
    ...(options.dailyPlanAutomationNow ? { now: options.dailyPlanAutomationNow } : {}),
    onEvent(event) {
      app.log.warn(event, 'daily plan automation failed');
    },
  });
  const nutritionService = createNutritionService(database, {
    nutritionDataProviderForOwner,
    healthTextProviderForOwner,
    healthLoopRepository,
    v07IdempotencyService,
    ...(options.healthTextProvider ? { healthTextProvider: options.healthTextProvider } : {}),
    ...(options.nutritionDataProvider ? { nutritionDataProvider: options.nutritionDataProvider } : {}),
  });
  const memoryProjectionRoot = options.memoryProjectionRoot
    ?? (databasePath === ':memory:' ? join(tmpdir(), 'ev-ai-assistant-memory') : join(dirname(databasePath), 'memory'));
  const memoryCompactionHook: { service?: ReturnType<typeof createMemoryCompactionService> } = {};
  const memoryService = createMemoryService(database, memoryProjectionRoot, {
    revisionHook: {
      onRevisionAppended(event) {
        memoryCompactionHook.service?.onLegacyRevisionAppended(event);
      },
    },
  });
  const entityMemoryService = createEntityMemoryService(
    database,
    memoryProjectionRoot,
    memoryService,
    {
      revisionHook: {
        onRevisionAppended(event) {
          memoryCompactionHook.service?.onEntityRevisionAppended(event);
        },
      },
    },
  );
  const memoryCompactionService = createMemoryCompactionService(database, entityMemoryService, {
    onEvent(event) {
      app.log.info(event, 'memory compaction');
    },
  });
  const defaultWorkoutPlanningProvider = createDeepSeekWorkoutPlanningProvider({ credentialService: providerCredentialService });
  const injectedWorkoutPlanningProvider = options.workoutPlanningProvider;
  const workoutPlanningProvider: WorkoutPlanningProvider = injectedWorkoutPlanningProvider && workoutPlanningDescriptor
    ? { descriptor: workoutPlanningDescriptor, generateWorkout: (owner, input, signal) => injectedWorkoutPlanningProvider.generateWorkout(owner, input, signal) }
    : defaultWorkoutPlanningProvider;
  const workoutPlanningService = createWorkoutPlanningService(
    database, calendarRepository, fitnessService, healthLoopRepository, v07IdempotencyService,
    { workoutPlanningProvider, memory: entityMemoryService,
      isConfigured: owner => workoutPlanningDescriptor?.adapterKind === 'TEST_FIXTURE' || defaultWorkoutPlanningProvider.configured(owner) },
  );
  memoryCompactionHook.service = memoryCompactionService;
  if (options.enableDailyPlanAutomation) dailyPlanAutomationService.scheduleNextRun();
  app.addHook('onClose', async () => {
    dailyPlanAutomationService.stop();
    runtimeLogger?.close();
    if (database.open) database.close();
  });
  await registerHealthRoutes(app, database, {
    authService,
    providerCredentialService,
    ...(options.readBackupHealthSnapshot !== undefined
      ? { readBackupHealthSnapshot: options.readBackupHealthSnapshot }
      : {}),
    ...(runtimeLogger !== undefined ? { runtimeLogger } : {}),
    schedulerStatus: options.enableDailyPlanAutomation ? 'unknown' : 'not_run',
  });
  await registerHealthLoopRoutes(app, { authService, healthTextProviderForOwner, nutritionDataProviderForOwner, ...(options.healthTextProvider ? { healthTextProvider: options.healthTextProvider } : {}), ...(options.nutritionDataProvider ? { nutritionDataProvider: options.nutritionDataProvider } : {}) });
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
  await registerEventLanguageRoutes(app, { authService, eventLanguageService });
  await registerFitnessRoutes(app, { authService, fitnessService });
  await registerFitnessPlanningRoutes(app, { authService, workoutPlanningService });
  await registerNutritionRoutes(app, { authService, nutritionService });
  await registerLearningRoutes(app, { authService, learningService });
  await registerMemoryRoutes(app, { authService, memoryService });
  await registerEntityMemoryRoutes(app, { authService, entityMemoryService });
  await registerMemoryCompactionRoutes(app, { authService, memoryCompactionService });
  await registerProposalRoutes(app, { authService, proposalService, idempotencyService });
  await registerProviderRoutes(app, { authService, providerService, providerCredentialService, capabilityRegistry, visionCapabilityForOwner });
  await registerNutritionCredentialRoutes(app, { authService, credentials: nutritionCredentials });
  await registerDailyPlanningRoutes(app, {
    authService,
    dailyPlanningService,
    dailyPlanCoordinationService,
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
