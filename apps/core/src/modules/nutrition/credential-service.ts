import { nutritionCredentialWriteSchema, type NutritionCredentialMetadata } from '@ev/contracts';
import type Database from 'better-sqlite3';
import { CredentialNotConfiguredError } from '../providers/credential-service';
import { SecretStoreUnavailableError, type SecretStorePort } from '../providers/secret-store';

export interface NutritionCredentialService {
  getMetadata(ownerId: string): NutritionCredentialMetadata;
  save(ownerId: string, apiKey: string): Promise<NutritionCredentialMetadata>;
  remove(ownerId: string): void;
  withApiKey(ownerId: string, callback: (apiKey: string) => Promise<void>): Promise<void>;
}

export function createNutritionCredentialService(database: Database.Database, secrets: SecretStorePort): NutritionCredentialService {
  const find = database.prepare('select protected_value, updated_at from nutrition_provider_credentials where owner_id = ?');
  const read = (ownerId: string) => find.get(ownerId) as { protected_value: string; updated_at: string } | undefined;
  const getMetadata = (ownerId: string): NutritionCredentialMetadata => {
    const row = read(ownerId);
    return { providerKey: 'USDA_FDC', state: row ? 'CONFIGURED' : 'NOT_CONFIGURED', updatedAt: row?.updated_at ?? null };
  };
  return {
    getMetadata,
    async save(ownerId, apiKey) {
      const input = nutritionCredentialWriteSchema.parse({ apiKey });
      let protectedValue: string;
      try { protectedValue = await secrets.protect(input.apiKey); }
      catch { throw new SecretStoreUnavailableError(); }
      database.prepare(`insert into nutrition_provider_credentials(owner_id, provider_key, protected_value, updated_at)
        values (?, 'USDA_FDC', ?, ?) on conflict(owner_id) do update set
        protected_value = excluded.protected_value, updated_at = excluded.updated_at`)
        .run(ownerId, protectedValue, new Date().toISOString());
      return getMetadata(ownerId);
    },
    remove(ownerId) { database.prepare('delete from nutrition_provider_credentials where owner_id = ?').run(ownerId); },
    async withApiKey(ownerId, callback) {
      const row = read(ownerId);
      if (!row) throw new CredentialNotConfiguredError();
      let apiKey: string;
      try { apiKey = await secrets.unprotect(row.protected_value); }
      catch { throw new SecretStoreUnavailableError(); }
      await callback(apiKey);
    },
  };
}
