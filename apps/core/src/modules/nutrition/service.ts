import { randomUUID } from 'node:crypto';
import { mealRecordSchema, type CreateMealInput, type MealRecord } from '@ev/contracts';
import type Database from 'better-sqlite3';

export interface NutritionService {
  createConfirmedMeal(ownerId: string, input: CreateMealInput): MealRecord;
}

export function createNutritionService(
  database: Database.Database,
  options: { now?: () => Date; newId?: () => string } = {},
): NutritionService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  return {
    createConfirmedMeal(ownerId, input) {
      const totals = input.entries.reduce(
        (total, entry) => ({
          calories: total.calories + entry.calories,
          proteinGrams: total.proteinGrams + entry.proteinGrams,
          carbohydrateGrams: total.carbohydrateGrams + entry.carbohydrateGrams,
          fatGrams: total.fatGrams + entry.fatGrams,
        }),
        { calories: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
      );
      const record = mealRecordSchema.parse({
        id: newId(),
        localDate: input.localDate,
        entries: input.entries,
        totals,
        createdAt: now().toISOString(),
      });
      database
        .prepare(
          `insert into meal_records (
             id, owner_id, local_date, entries_json, calories, protein_grams, carbohydrate_grams,
             fat_grams, created_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          ownerId,
          record.localDate,
          JSON.stringify(record.entries),
          record.totals.calories,
          record.totals.proteinGrams,
          record.totals.carbohydrateGrams,
          record.totals.fatGrams,
          record.createdAt,
        );
      return record;
    },
  };
}
