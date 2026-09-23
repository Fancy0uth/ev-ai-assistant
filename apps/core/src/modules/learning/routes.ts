import {
  courseDetailResponseSchema,
  courseListResponseSchema,
  coursePathParamsSchema,
  courseLearningContextResponseSchema,
  courseResourceSearchCreateResponseSchema,
  courseResourceSearchExecuteSchema,
  courseResourceSearchResponseSchema,
  courseResourceListResponseSchema,
  courseResourceResponseSchema,
  courseResponseSchema,
  createLearningRunSchema,
  createCourseResourceSchema,
  createCourseResourceSearchSchema,
  createCourseSchema,
  updateCourseLearningContextSchema,
  learningRunGenerateResponseSchema,
  learningRunGenerateSchema,
  learningRunResponseSchema,
  learningRunCreateResponseSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../../http/api-error';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { createLearningService } from './service';

export async function registerLearningRoutes(
  app: FastifyInstance,
  options: { authService: AuthService; learningService: ReturnType<typeof createLearningService> },
): Promise<void> {
  const guard = createAuthGuard(options.authService);

  app.post('/v1/courses', { preHandler: guard }, (request, reply) => {
    const course = options.learningService.createCourse(
      authenticatedOwnerId(request),
      parseRequestInput(createCourseSchema, request.body, '课程信息不符合要求'),
    );
    return reply.status(201).send(courseResponseSchema.parse({ data: course }));
  });

  app.get('/v1/courses', { preHandler: guard }, (request) => {
    return courseListResponseSchema.parse({
      data: options.learningService.listCourses(authenticatedOwnerId(request)),
    });
  });

  app.get('/v1/courses/:id', { preHandler: guard }, (request) => {
    const { id } = parseRequestInput(coursePathParamsSchema, request.params, '课程路径参数不符合要求');
    return courseDetailResponseSchema.parse({ data: options.learningService.getCourseDetail(authenticatedOwnerId(request), id) });
  });

  app.patch('/v1/courses/:id/learning-context', { preHandler: guard }, (request) => {
    const { id } = parseRequestInput(coursePathParamsSchema, request.params, '课程路径参数不符合要求');
    return courseLearningContextResponseSchema.parse({
      data: options.learningService.updateLearningContext(authenticatedOwnerId(request), id, parseRequestInput(updateCourseLearningContextSchema, request.body, '课程学习进度不符合要求')),
    });
  });

  app.get('/v1/courses/:id/resources', { preHandler: guard }, (request) => {
    const { id } = parseRequestInput(coursePathParamsSchema, request.params, '课程路径参数不符合要求');
    return courseResourceListResponseSchema.parse({
      data: options.learningService.listResources(authenticatedOwnerId(request), id),
    });
  });

  app.post('/v1/courses/:id/resources', { preHandler: guard }, (request, reply) => {
    const { id } = parseRequestInput(coursePathParamsSchema, request.params, '课程路径参数不符合要求');
    const resource = options.learningService.addResource(
      authenticatedOwnerId(request),
      id,
      parseRequestInput(createCourseResourceSchema, request.body, '课程资料不符合要求'),
    );
    return reply.status(201).send(courseResourceResponseSchema.parse({ data: resource }));
  });

  app.post('/v1/courses/:id/resource-searches', { preHandler: guard }, (request, reply) => {
    const { id } = parseRequestInput(coursePathParamsSchema, request.params, '课程路径参数不符合要求');
    return reply.status(201).send(courseResourceSearchCreateResponseSchema.parse({
      data: options.learningService.createResourceSearch(authenticatedOwnerId(request), id, parseRequestInput(createCourseResourceSearchSchema, request.body, '公开资料检索请求不符合要求')),
    }));
  });

  app.get('/v1/resource-searches/:id', { preHandler: guard }, (request) => {
    const { id } = parseRequestInput(coursePathParamsSchema, request.params, '公开资料检索路径参数不符合要求');
    return courseResourceSearchResponseSchema.parse({ data: options.learningService.getResourceSearch(authenticatedOwnerId(request), id) });
  });

  app.post('/v1/resource-searches/:id/execute', { preHandler: guard }, async (request, reply) => {
    const { id } = parseRequestInput(coursePathParamsSchema, request.params, '公开资料检索路径参数不符合要求');
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '公开资料检索需要 Idempotency-Key');
    const result = await options.learningService.executeResourceSearch(
      authenticatedOwnerId(request),
      id,
      parseRequestInput(courseResourceSearchExecuteSchema, request.body, '公开资料检索执行请求不符合要求'),
      key,
    );
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(202).send(courseResourceSearchResponseSchema.parse({ data: { run: result.run, citations: result.citations } }));
  });

  app.post('/v1/courses/:id/learning-runs', { preHandler: guard }, (request, reply) => {
    const { id } = parseRequestInput(coursePathParamsSchema, request.params, '课程路径参数不符合要求');
    return reply.status(201).send(learningRunCreateResponseSchema.parse({
      data: options.learningService.createLearningRun(authenticatedOwnerId(request), id, parseRequestInput(createLearningRunSchema, request.body, '学习建议请求不符合要求')),
    }));
  });

  app.get('/v1/learning-runs/:id', { preHandler: guard }, (request) => {
    const { id } = parseRequestInput(coursePathParamsSchema, request.params, '学习建议路径参数不符合要求');
    return learningRunResponseSchema.parse({ data: options.learningService.getLearningRun(authenticatedOwnerId(request), id) });
  });

  app.post('/v1/learning-runs/:id/generate', { preHandler: guard }, async (request, reply) => {
    const { id } = parseRequestInput(coursePathParamsSchema, request.params, '学习建议路径参数不符合要求');
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '学习建议需要 Idempotency-Key');
    const result = await options.learningService.executeLearningRun(
      authenticatedOwnerId(request), id,
      parseRequestInput(learningRunGenerateSchema, request.body, '学习建议执行请求不符合要求'), key,
    );
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(202).send(learningRunGenerateResponseSchema.parse({ data: { run: result.run, proposal: result.proposal } }));
  });
}
