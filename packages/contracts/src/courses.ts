import * as z from 'zod';

const titleSchema = z.string().trim().min(1).max(200);
const urlSchema = z.url().max(2000);

export const courseSchema = z.object({
  id: z.uuid(), termId: z.uuid(), title: titleSchema, courseCode: z.string().max(80).nullable(),
  officialUrl: urlSchema.nullable(), version: z.number().int().positive(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
export const createCourseSchema = z.object({
  termId: z.uuid(), title: titleSchema, courseCode: z.string().trim().min(1).max(80).optional(), officialUrl: urlSchema.optional(),
}).strict();
export const coursePathParamsSchema = z.object({ id: z.uuid() }).strict();
export const courseResourceSchema = z.object({
  id: z.uuid(), courseId: z.uuid(), title: titleSchema, url: urlSchema, source: z.enum(['USER_PROVIDED', 'PUBLIC_SEARCH']), createdAt: z.iso.datetime(),
}).strict();
export const createCourseResourceSchema = z.object({ title: titleSchema, url: urlSchema }).strict();
export const courseResponseSchema = z.object({ data: courseSchema }).strict();
export const courseListResponseSchema = z.object({ data: z.array(courseSchema) }).strict();
export const courseResourceResponseSchema = z.object({ data: courseResourceSchema }).strict();
export const courseResourceListResponseSchema = z.object({ data: z.array(courseResourceSchema) }).strict();
export type Course = z.infer<typeof courseSchema>;
export type CourseResource = z.infer<typeof courseResourceSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type CreateCourseResourceInput = z.infer<typeof createCourseResourceSchema>;
