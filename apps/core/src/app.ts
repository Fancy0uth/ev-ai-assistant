import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ProviderKey } from '@ev/contracts';
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
import { createFitnessService } from './modules/fitness/service';
import { registerLearningRoutes } from './modules/learning/routes';
import { createLearningService } from './modules/learning/service';
import { registerMemoryRoutes } from './modules/memory/routes';
import { createMemoryService } from './modules/memory/service';
import { registerProjectScopeRoutes } from './modules/projects/routes';
import { createProjectScopeService } from './modules/projects/scope-service';
import { createProposalRepository } from './modules/proposals/repository';
import { registerProposalRoutes } from './modules/proposals/routes';
import { createProposalService } from './modules/proposals/service';
import { registerNutritionRoutes } from './modules/nutrition/routes';
import { createNutritionService } from './modules/nutrition/service';
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
  learningAdviceCapability?: LearningAdviceCapability;
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
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
  });
  const databasePath = options.databasePath ?? ':memory:';
  const database = openDatabase(databasePath);
  const dataRoot = databasePath === ':memory:' ? join(tmpdir(), 'ev-ai-assistant') : dirname(databasePath);
  const artifactRoot = options.artifactRoot ?? join(dataRoot, 'artifacts');
  const capabilityRegistry = createCapabilityRegistry({
    dataRoot,
    ...(options.visionCapability ? { vision: options.visionCapability } : {}),
    ...(options.publicSearchCapability ? { publicSearch: options.publicSearchCapability } : {}),
    ...(options.learningAdviceCapability ? { learningAdvice: options.learningAdviceCapability } : {}),
  });
  createCapabilityRunRepository(database).sweepExpired((options.providerReliabilityNow ?? (() => new Date()))().toISOString());

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
  const proposalRepository = createProposalRepository(database);
  const proposalService = createProposalService(proposalRepository, calendarRepository);
  const calendarService = createCalendarService(calendarRepository, proposalService);
  const taskService = createTaskService(taskRepository, {
    schedulingUnitOfWork: createTaskSchedulingUnitOfWork(database, {
      taskRepository,
      calendarRepository,
      newId: () => crypto.randomUUID(),
      now: () => new Date(),
    }),
  });
  const fitnessService = createFitnessService(calendarRepository);
  const learningService = createLearningService(database, calendarRepository);
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
  );
  const providerService = createProviderService(database, {
    providers: {
      ...(options.domainAgentProvider ? { [options.domainAgentProvider.key]: options.domainAgentProvider } : {}),
      ...options.domainAgentProviders,
    },
  });
  const providerCredentialService = createProviderCredentialService(
    database,
    options.secretStore ?? createWindowsDpapiSecretStore(),
    options.deepSeekConnectionTester ? { connectionTester: options.deepSeekConnectionTester } : {},
  );
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
  const nutritionService = createNutritionService(database);
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
  });

  return app;
}
