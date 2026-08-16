import * as z from 'zod';
import { localDateSchema } from './tasks';

export const confirmedMealEntrySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    grams: z.number().positive().max(5000),
    calories: z.number().nonnegative().max(20000),
    proteinGrams: z.number().nonnegative().max(1000),
    carbohydrateGrams: z.number().nonnegative().max(3000),
    fatGrams: z.number().nonnegative().max(1000),
  })
  .strict();

export const createMealSchema = z
  .object({
    localDate: localDateSchema,
    entries: z.array(confirmedMealEntrySchema).min(1).max(30),
  })
  .strict();

export const mealRecordSchema = z
  .object({
    id: z.uuid(),
    localDate: localDateSchema,
    entries: z.array(confirmedMealEntrySchema).min(1),
    totals: z
      .object({
        calories: z.number().nonnegative(),
        proteinGrams: z.number().nonnegative(),
        carbohydrateGrams: z.number().nonnegative(),
        fatGrams: z.number().nonnegative(),
      })
      .strict(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const mealRecordResponseSchema = z.object({ data: mealRecordSchema }).strict();

export type CreateMealInput = z.infer<typeof createMealSchema>;
export type MealRecord = z.infer<typeof mealRecordSchema>;
