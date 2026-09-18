import * as z from 'zod';
import { localDateSchema } from './tasks';

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

export const entityMemoryScopeTypeSchema = z.enum([
  'DOMAIN',
  'PROJECT',
  'COURSE',
  'FITNESS',
  'NUTRITION',
  'DAILY',
]);
export const entityMemoryScopeIdSchema = z.string().trim().min(1).max(200);
export const entityMemoryScopePathSchema = z.discriminatedUnion('scopeType', [
  z.object({ scopeType: z.literal('DOMAIN'), scopeId: memoryScopeSchema }).strict(),
  z.object({ scopeType: z.literal('PROJECT'), scopeId: entityMemoryScopeIdSchema }).strict(),
  z.object({ scopeType: z.literal('COURSE'), scopeId: entityMemoryScopeIdSchema }).strict(),
  z.object({ scopeType: z.literal('FITNESS'), scopeId: entityMemoryScopeIdSchema }).strict(),
  z.object({ scopeType: z.literal('NUTRITION'), scopeId: entityMemoryScopeIdSchema }).strict(),
  z.object({ scopeType: z.literal('DAILY'), scopeId: localDateSchema }).strict(),
]);

export const entityMemoryDocumentSchema = z.object({
  scopeType: entityMemoryScopeTypeSchema,
  scopeId: entityMemoryScopeIdSchema,
  content: z.string().min(1).max(20_000),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();

export const entityMemoryRevisionSourceSchema = z.enum(['WRITE', 'RESTORE', 'LEGACY']);
export const entityMemoryRevisionSchema = z.object({
  id: z.string().min(1).max(200),
  scopeType: entityMemoryScopeTypeSchema,
  scopeId: entityMemoryScopeIdSchema,
  content: z.string().min(1).max(20_000),
  version: z.number().int().positive(),
  parentRevisionId: z.string().min(1).max(200).nullable(),
  sourceRevisionId: z.string().min(1).max(200).nullable(),
  source: entityMemoryRevisionSourceSchema,
  expectedVersion: z.number().int().positive().nullable(),
  contentBytes: z.number().int().positive(),
  createdAt: z.iso.datetime(),
}).strict();

export const entityMemoryDocumentResponseSchema = z.object({ data: entityMemoryDocumentSchema }).strict();
export const entityMemoryRevisionListResponseSchema = z.object({ data: z.array(entityMemoryRevisionSchema) }).strict();

export const memoryCompactionModeSchema = z.enum(['LOCAL_RULES', 'EXTERNAL']);
export const memoryCompactionTriggerSchema = z.enum(['MANUAL', 'THRESHOLD']);
export const memoryCompactionStatusSchema = z.enum([
  'PENDING',
  'REJECTED',
  'ACCEPTED',
  'BLOCKED',
  'FAILED',
  'INVALIDATED',
]);
export const memoryCompactionSourceRevisionSchema = z.object({
  id: z.string().min(1).max(200),
  version: z.number().int().positive(),
  contentBytes: z.number().int().positive(),
}).strict();
export const memoryCompactionDiffSegmentSchema = z.object({
  segment: z.string().min(1).max(20_000),
  sourceIndexes: z.array(z.number().int().nonnegative()).min(1).max(20_000),
}).strict();
export const memoryCompactionDiffSchema = z.object({
  kept: z.array(memoryCompactionDiffSegmentSchema).max(20_000),
  merged: z.array(memoryCompactionDiffSegmentSchema).max(20_000),
}).strict();
export const memoryCompactionDraftSchema = z.object({
  id: z.string().min(1).max(200),
  scopeType: entityMemoryScopeTypeSchema,
  scopeId: entityMemoryScopeIdSchema,
  mode: memoryCompactionModeSchema,
  trigger: memoryCompactionTriggerSchema,
  status: memoryCompactionStatusSchema,
  baseVersion: z.number().int().positive(),
  sourceRevisions: z.array(memoryCompactionSourceRevisionSchema),
  content: z.string().min(1).max(16_384).nullable(),
  summary: z.string().min(1).max(500),
  diff: memoryCompactionDiffSchema.nullable(),
  inputBytes: z.number().int().positive(),
  outputBytes: z.number().int().positive().nullable(),
  byteBudget: z.literal(16_384),
  failureCode: z.string().min(1).max(120).nullable(),
  resultRevisionVersion: z.number().int().positive().nullable(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  invalidatedAt: z.iso.datetime().nullable(),
}).strict();
export const createMemoryCompactionDraftSchema = z.object({
  scopeType: entityMemoryScopeTypeSchema,
  scopeId: entityMemoryScopeIdSchema,
  mode: memoryCompactionModeSchema,
  expectedVersion: z.number().int().positive(),
}).strict();
export const memoryCompactionDraftPathSchema = z.object({
  draftId: z.string().trim().min(1).max(200),
}).strict();
export const rejectMemoryCompactionDraftSchema = z.object({
  expectedDraftVersion: z.number().int().positive(),
}).strict();
export const confirmMemoryCompactionDraftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  expectedDraftVersion: z.number().int().positive(),
}).strict();
export const restoreMemoryCompactionDraftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  revisionVersion: z.number().int().positive(),
}).strict();
export const memoryCompactionDraftResponseSchema = z.object({
  data: z.object({ draft: memoryCompactionDraftSchema, reused: z.boolean() }).strict(),
}).strict();
export const memoryCompactionDraftDetailResponseSchema = z.object({
  data: z.object({ draft: memoryCompactionDraftSchema }).strict(),
}).strict();
export const memoryCompactionDraftListResponseSchema = z.object({
  data: z.object({ items: z.array(memoryCompactionDraftSchema) }).strict(),
}).strict();
export const memoryCompactionOutcomeResponseSchema = z.object({
  data: z.object({ draft: memoryCompactionDraftSchema, document: entityMemoryDocumentSchema }).strict(),
}).strict();

export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export type MemoryDocument = z.infer<typeof memoryDocumentSchema>;
export type MemoryRevision = z.infer<typeof memoryRevisionSchema>;
export type EntityMemoryScopeType = z.infer<typeof entityMemoryScopeTypeSchema>;
export type EntityMemoryScopePath = z.infer<typeof entityMemoryScopePathSchema>;
export type EntityMemoryDocument = z.infer<typeof entityMemoryDocumentSchema>;
export type EntityMemoryRevision = z.infer<typeof entityMemoryRevisionSchema>;
export type MemoryCompactionDraft = z.infer<typeof memoryCompactionDraftSchema>;
