import * as z from 'zod';

export const nutritionCredentialMetadataSchema = z.object({
  providerKey: z.literal('USDA_FDC'),
  state: z.enum(['CONFIGURED', 'NOT_CONFIGURED']),
  updatedAt: z.iso.datetime().nullable(),
}).strict();
export const nutritionCredentialResponseSchema = z.object({ data: nutritionCredentialMetadataSchema }).strict();
export const nutritionCredentialWriteSchema = z.object({
  apiKey: z.string().trim().min(8).max(256).regex(/^[A-Za-z0-9_-]+$/)
    .refine((value) => value !== 'DEMO_KEY', '请配置个人 FoodData Central API key'),
}).strict();
export const nutritionCredentialDeleteSchema = z.object({ confirm: z.literal(true) }).strict();
export type NutritionCredentialMetadata = z.infer<typeof nutritionCredentialMetadataSchema>;
