import * as z from 'zod';

const labelSchema = z.string().trim().min(1).max(120);
const localPathSchema = z.string().trim().min(1).max(2000);

export const projectScopeSchema = z.object({
  id: z.uuid(),
  label: labelSchema,
  rootPath: localPathSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();

export const createProjectScopeSchema = z.object({ label: labelSchema, rootPath: localPathSchema }).strict();
export const projectScopePathSchema = z.object({ id: z.uuid() }).strict();
export const projectSnapshotFileSchema = z.object({ relativePath: z.enum(['PRD.md', 'TECH_SPEC.md', 'ARCHITECTURE.md', 'TASKS.md']), content: z.string().max(256_000) }).strict();
export const projectSnapshotSchema = z.object({ scope: projectScopeSchema, files: z.array(projectSnapshotFileSchema).max(4) }).strict();

export const projectScopeResponseSchema = z.object({ data: projectScopeSchema }).strict();
export const projectScopeListResponseSchema = z.object({ data: z.array(projectScopeSchema) }).strict();
export const projectSnapshotResponseSchema = z.object({ data: projectSnapshotSchema }).strict();

export type ProjectScope = z.infer<typeof projectScopeSchema>;
export type CreateProjectScopeInput = z.infer<typeof createProjectScopeSchema>;
