import {
  courseImportPathParamsSchema,
  courseImportResponseSchema,
  createCourseImportSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { CourseImportService } from './import-service';

interface CourseImportRouteOptions {
  authService: AuthService;
  courseImportService: CourseImportService;
}

export async function registerCourseImportRoutes(
  app: FastifyInstance,
  options: CourseImportRouteOptions,
): Promise<void> {
  const authGuard = createAuthGuard(options.authService);

  app.post('/v1/course-imports', { preHandler: authGuard }, async (request, reply) => {
    const input = parseRequestInput(createCourseImportSchema, request.body, '课表截图不符合要求');
    const result = await options.courseImportService.create(authenticatedOwnerId(request), input);
    return reply.status(202).send(courseImportResponseSchema.parse({ data: result }));
  });

  app.get('/v1/course-imports/:id', { preHandler: authGuard }, async (request) => {
    const { id } = parseRequestInput(
      courseImportPathParamsSchema,
      request.params,
      '课表导入路径参数不符合要求',
    );
    const result = options.courseImportService.findById(authenticatedOwnerId(request), id);
    return courseImportResponseSchema.parse({ data: result });
  });
}
