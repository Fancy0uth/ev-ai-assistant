import {
  courseListResponseSchema,
  coursePathParamsSchema,
  courseResourceListResponseSchema,
  courseResourceResponseSchema,
  courseResponseSchema,
  createCourseResourceSchema,
  createCourseSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
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
}
