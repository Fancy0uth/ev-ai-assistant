import * as z from 'zod';

export const memoryScopeSchema = z.enum(['GENERAL', 'FITNESS', 'LEARNING', 'PROJECT']);

export const memoryDocumentSchema = z.object({
  scope: memoryScopeSchema,
  content: z.string().min(1).max(20_000),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();

export const memoryRevisionSchema = z.object({
  scope: memoryScopeSchema,
  content: z.string().min(1).max(20_000),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
}).strict();

export const memoryScopePathSchema = z.object({ scope: memoryScopeSchema }).strict();
export const writeMemorySchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  expectedVersion: z.number().int().positive().nullable(),
}).strict();
export const restoreMemorySchema = z.object({
  expectedVersion: z.number().int().positive(),
  revisionVersion: z.number().int().positive(),
}).strict();
export const deleteMemorySchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

export const memoryDocumentResponseSchema = z.object({ data: memoryDocumentSchema }).strict();
export const memoryDocumentListResponseSchema = z.object({ data: z.array(memoryDocumentSchema) }).strict();
export const memoryRevisionListResponseSchema = z.object({ data: z.array(memoryRevisionSchema) }).strict();

export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export type MemoryDocument = z.infer<typeof memoryDocumentSchema>;
export type MemoryRevision = z.infer<typeof memoryRevisionSchema>;
