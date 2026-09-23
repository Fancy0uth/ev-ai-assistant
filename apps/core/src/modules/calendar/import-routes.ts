import {
  courseArtifactPathParamsSchema,
  courseArtifactResponseSchema,
  courseImportPathParamsSchema,
  courseImportResponseSchema,
  confirmCourseImportSchema,
  createCourseImportSchema,
  extractCourseImportSchema,
  saveCourseImportRevisionSchema,
  courseScheduleImageMediaTypeSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../../http/api-error';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { CourseImportService } from './import-service';

const imageMediaTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
const rawBodyLimit = 5_000_000;

interface CourseImportRouteOptions { authService: AuthService; courseImportService: CourseImportService; }

export async function registerCourseImportRoutes(app: FastifyInstance, options: CourseImportRouteOptions): Promise<void> {
  const authGuard = createAuthGuard(options.authService);
  for (const mediaType of imageMediaTypes) {
    app.addContentTypeParser(mediaType, { parseAs: 'buffer', bodyLimit: rawBodyLimit }, (_request, body, done) => done(null, body));
  }
  app.post('/v1/course-artifacts', { preHandler: authGuard, bodyLimit: rawBodyLimit }, async (request, reply) => {
    const mediaType = courseScheduleImageMediaTypeSchema.safeParse(request.headers['content-type']?.split(';', 1)[0]);
    if (!mediaType.success) throw new ApiError(415, 'UNSUPPORTED_IMAGE_TYPE', '仅支持 PNG、JPEG 或 WebP 图片');
    const result = await options.courseImportService.uploadArtifact(
      authenticatedOwnerId(request), mediaType.data, request.body as Uint8Array,
    );
    return reply.status(result.deduplicated ? 200 : 201).send(courseArtifactResponseSchema.parse({ data: result }));
  });
  app.delete('/v1/course-artifacts/:id', { preHandler: authGuard }, async (request, reply) => {
    const { id } = parseRequestInput(courseArtifactPathParamsSchema, request.params, '图片路径参数不符合要求');
    await options.courseImportService.deleteArtifact(authenticatedOwnerId(request), id);
    return reply.status(204).send();
  });
  app.post('/v1/course-imports', { preHandler: authGuard }, async (request, reply) => {
    const input = parseRequestInput(createCourseImportSchema, request.body, '课表导入请求不符合要求');
    const result = options.courseImportService.create(authenticatedOwnerId(request), input);
    return reply.status(201).send(courseImportResponseSchema.parse({ data: result }));
  });
  app.get('/v1/course-imports/:id', { preHandler: authGuard }, async (request) => {
    const { id } = parseRequestInput(courseImportPathParamsSchema, request.params, '课表导入路径参数不符合要求');
    return courseImportResponseSchema.parse({ data: options.courseImportService.findById(authenticatedOwnerId(request), id) });
  });
  app.post('/v1/course-imports/:id/extract', { preHandler: authGuard }, async (request, reply) => {
    const { id } = parseRequestInput(courseImportPathParamsSchema, request.params, '课表导入路径参数不符合要求');
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '课表提取需要 Idempotency-Key');
    const input = parseRequestInput(extractCourseImportSchema, request.body, '课表提取请求不符合要求');
    return reply.status(202).send(courseImportResponseSchema.parse({ data: await options.courseImportService.extract(authenticatedOwnerId(request), id, input, key) }));
  });
  app.post('/v1/course-imports/:id/revisions', { preHandler: authGuard }, async (request, reply) => {
    const { id } = parseRequestInput(courseImportPathParamsSchema, request.params, '课表导入路径参数不符合要求');
    const input = parseRequestInput(saveCourseImportRevisionSchema, request.body, '课表候选修订不符合要求');
    return reply.status(201).send(courseImportResponseSchema.parse({ data: options.courseImportService.saveRevision(authenticatedOwnerId(request), id, input) }));
  });
  app.post('/v1/course-imports/:id/confirm', { preHandler: authGuard }, async (request, reply) => {
    const { id } = parseRequestInput(courseImportPathParamsSchema, request.params, '课表导入路径参数不符合要求');
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '确认课程需要 Idempotency-Key');
    const input = parseRequestInput(confirmCourseImportSchema, request.body, '确认课程请求不符合要求');
    return reply.status(201).send(courseImportResponseSchema.parse({ data: options.courseImportService.confirm(authenticatedOwnerId(request), id, input, key) }));
  });
}
