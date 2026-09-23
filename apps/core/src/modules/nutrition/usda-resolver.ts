import type { NutritionCredentialService } from './credential-service';
import type { NutritionDataProvider } from './provider';
import { createUsdaNutritionDataProvider, usdaNutritionDataDescriptor } from './usda-food-data';

export function createUsdaNutritionResolver(credentials: NutritionCredentialService): (ownerId: string) => NutritionDataProvider | undefined {
  return (ownerId) => {
    if (credentials.getMetadata(ownerId).state !== 'CONFIGURED') return undefined;
    return {
      descriptor: usdaNutritionDataDescriptor,
      async searchBatch(input, signal) {
        if (signal.aborted) throw new Error('NUTRITION_DATA_ABORTED');
        let output: unknown;
        await credentials.withApiKey(ownerId, async (apiKey) => {
          if (signal.aborted) throw new Error('NUTRITION_DATA_ABORTED');
          output = await createUsdaNutritionDataProvider({ apiKey }).searchBatch(input, signal);
        });
        return output;
      },
    };
  };
}
