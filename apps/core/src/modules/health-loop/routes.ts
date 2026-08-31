import { healthCapabilitiesResponseSchema, type HealthCapabilityDescriptor, type HealthTextProvider } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import type { NutritionDataProvider } from '../nutrition/provider';
import { createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';

function unavailable(capability: HealthCapabilityDescriptor['capability']): HealthCapabilityDescriptor {
  return { capability, availability: 'NOT_CONFIGURED', providerId: null, providerLabel: 'Not configured', adapterKind: 'NONE', evidenceKind: 'NONE', disclosureVersion: 'HEALTH_DISCLOSURE_V1', policyVersion: 'HEALTH_CAPABILITY_POLICY_V1', realEvidenceStatus: 'NOT_RUN_APPROVAL_REQUIRED' };
}

function ready(capability: HealthCapabilityDescriptor['capability'], descriptor: { providerId: string; providerLabel: string; adapterKind: HealthCapabilityDescriptor['adapterKind']; evidenceKind: HealthCapabilityDescriptor['evidenceKind'] }): HealthCapabilityDescriptor {
  return { capability, availability: 'READY', providerId: descriptor.providerId, providerLabel: descriptor.providerLabel, adapterKind: descriptor.adapterKind, evidenceKind: descriptor.evidenceKind, disclosureVersion: 'HEALTH_DISCLOSURE_V1', policyVersion: 'HEALTH_CAPABILITY_POLICY_V1', realEvidenceStatus: descriptor.evidenceKind === 'REAL_PROVIDER' ? 'AVAILABLE' : 'NOT_RUN_APPROVAL_REQUIRED' };
}

export async function registerHealthLoopRoutes(app: FastifyInstance, options: { authService: AuthService; healthTextProvider?: HealthTextProvider; nutritionDataProvider?: NutritionDataProvider }): Promise<void> {
  const authGuard = createAuthGuard(options.authService);
  app.get('/v1/health-capabilities', { preHandler: authGuard }, async (_request, reply) => {
    const data = [
      options.healthTextProvider ? ready('WORKOUT_TEXT_SELECTION', options.healthTextProvider.descriptor) : unavailable('WORKOUT_TEXT_SELECTION'),
      options.healthTextProvider ? ready('MEAL_CANDIDATE_PARSE', options.healthTextProvider.descriptor) : unavailable('MEAL_CANDIDATE_PARSE'),
      options.nutritionDataProvider ? ready('NUTRITION_DATA_LOOKUP', options.nutritionDataProvider.descriptor) : unavailable('NUTRITION_DATA_LOOKUP'),
    ] as const;
    return reply.send(healthCapabilitiesResponseSchema.parse({ data }));
  });
}
