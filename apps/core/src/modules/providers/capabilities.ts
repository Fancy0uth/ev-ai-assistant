import { relative, resolve, sep } from 'node:path';
import type {
  CapabilityAdapterDescriptor,
  CapabilityDescriptor,
  CitedLearningAdviceInput,
  CourseScheduleImageMediaType,
} from '@ev/contracts';

export interface VisionCapability {
  readonly descriptor: CapabilityAdapterDescriptor;
  extractCourseSchedule(input: {
    schemaVersion: 'COURSE_SCHEDULE_EXTRACTION_V1';
    image: Readonly<Uint8Array>;
    mediaType: CourseScheduleImageMediaType;
    term: { timezone: string; weekOneMonday: string };
  }): Promise<unknown>;
}

export interface PublicSearchCapability {
  readonly descriptor: CapabilityAdapterDescriptor;
  search(input: { query: string; maxResults: 5 }): Promise<unknown>;
}

export interface LearningAdviceCapability {
  readonly descriptor: CapabilityAdapterDescriptor;
  generate(input: CitedLearningAdviceInput): Promise<unknown>;
}

export interface LearningAdviceCapabilityFactory {
  readonly descriptor: CapabilityAdapterDescriptor;
  create(apiKey: string): LearningAdviceCapability;
}

export interface CapabilityRegistry {
  readonly vision: VisionCapability | undefined;
  readonly publicSearch: PublicSearchCapability | undefined;
  readonly learningAdvice: LearningAdviceCapability | undefined;
  list(): CapabilityDescriptor[];
  visionDisclosure(): CapabilityDescriptor;
}

function underRoot(path: string, root: string): boolean {
  const remainder = relative(resolve(root), resolve(path));
  return remainder === '' || (!remainder.startsWith(`..${sep}`) && remainder !== '..' && !remainder.includes(`..${sep}`));
}

function assertFakeGate(dataRoot: string, descriptor: CapabilityAdapterDescriptor): void {
  if (descriptor.adapterKind !== 'TEST_FAKE') return;
  if (process.env.NODE_ENV !== 'test') throw new Error('test fake requires NODE_ENV=test');
  if (process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS !== '1') throw new Error('test fake requires explicit v0.6 adapter flag');
  const runRoot = process.env.EV_E2E_RUN_DIR;
  if (!runRoot || !underRoot(dataRoot, runRoot)) throw new Error('test fake data root must be runner-owned');
}

function descriptor(
  capability: CapabilityDescriptor['capability'],
  adapter: CapabilityAdapterDescriptor | undefined,
): CapabilityDescriptor {
  if (!adapter) {
    return { capability, providerId: null, providerLabel: '未配置', adapterKind: 'NONE', evidenceKind: 'NONE', availability: 'BLOCKED_PROVIDER' };
  }
  return {
    capability,
    ...adapter,
    evidenceKind: adapter.adapterKind === 'TEST_FAKE' ? 'AUTOMATED_FAKE' : 'NONE',
    availability: 'READY',
  };
}

export function terminalEvidenceKind(adapterKind: CapabilityAdapterDescriptor['adapterKind']): CapabilityDescriptor['evidenceKind'] {
  if (adapterKind === 'TEST_FAKE') return 'AUTOMATED_FAKE';
  if (adapterKind === 'PRODUCTION_ADAPTER') return 'REAL_PROVIDER';
  return 'NONE';
}

export function createCapabilityRegistry(input: {
  dataRoot: string;
  vision?: VisionCapability;
  publicSearch?: PublicSearchCapability;
  learningAdvice?: LearningAdviceCapability;
}): CapabilityRegistry {
  for (const capability of [input.vision, input.publicSearch, input.learningAdvice]) {
    if (capability) assertFakeGate(input.dataRoot, capability.descriptor);
  }
  const vision = descriptor('COURSE_SCHEDULE_VISION', input.vision?.descriptor);
  const publicSearch = descriptor('PUBLIC_LEARNING_SEARCH', input.publicSearch?.descriptor);
  const learningAdvice = descriptor('LEARNING_TEXT_ANALYSIS', input.learningAdvice?.descriptor);
  return {
    vision: input.vision,
    publicSearch: input.publicSearch,
    learningAdvice: input.learningAdvice,
    list: () => [vision, publicSearch, learningAdvice],
    visionDisclosure: () => vision,
  };
}
