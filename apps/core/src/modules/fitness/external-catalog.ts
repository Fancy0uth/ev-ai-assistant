const EXTERNAL_EXERCISE_CATALOG_INVALID = 'EXTERNAL_EXERCISE_CATALOG_INVALID';
const MAX_RECORDS = 2_000;
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_CLASSIFICATION_CHARACTERS = 240;
const MAX_SECONDARY_MUSCLES = 32;
const MAX_SECONDARY_MUSCLE_CHARACTERS = 120;
const MAX_STEPS_PER_LANGUAGE = 40;
const MAX_STEP_CHARACTERS = 2_000;
const MAX_TOTAL_STEP_CHARACTERS = 24_000;

const sourceId = 'hasaneyldrm/exercises-dataset' as const;
const license = 'MIT' as const;

type InstructionLanguage = 'en' | 'zh';
type JsonRecord = Record<string, unknown>;

export interface ExternalExerciseCatalogItem {
  upstreamId: string;
  name: string;
  bodyPart: string;
  equipment: string;
  target: string;
  secondaryMuscles: string[];
  instructions: {
    en: string[];
    zh: string[];
  };
  safetyReview: 'UNREVIEWED';
}

export interface ExternalExerciseCatalog {
  sourceId: typeof sourceId;
  revision: string;
  license: typeof license;
  items: ExternalExerciseCatalogItem[];
}

function invalid(): never {
  throw new Error(EXTERNAL_EXERCISE_CATALOG_INVALID);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isArrayIndexKey(key: string): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key;
}

function isJsonCompatible(value: unknown, ancestors = new WeakSet<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const dataKeys = Object.keys(descriptors).filter((key) => key !== 'length');
      if (dataKeys.length !== value.length || dataKeys.some((key) => !isArrayIndexKey(key))) return false;
      return dataKeys.every((key) => {
        const descriptor = descriptors[key];
        return descriptor !== undefined
          && Object.hasOwn(descriptor, 'value')
          && isJsonCompatible(descriptor.value, ancestors);
      });
    }
    if (!isJsonRecord(value)) return false;
    return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => (
      descriptor.enumerable === true
      && Object.hasOwn(descriptor, 'value')
      && isJsonCompatible(descriptor.value, ancestors)
    ));
  } finally {
    ancestors.delete(value);
  }
}

function characterCount(value: string): number {
  return [...value].length;
}

function parseText(value: unknown, maximumCharacters: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || characterCount(value) > maximumCharacters) invalid();
  return value;
}

function parseSteps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_STEPS_PER_LANGUAGE) invalid();
  return value.map((step) => parseText(step, MAX_STEP_CHARACTERS));
}

function parseLanguageInstructions(record: JsonRecord, language: InstructionLanguage): string[] {
  if (Object.hasOwn(record, 'instruction_steps')) {
    const instructionSteps = record.instruction_steps;
    if (!isJsonRecord(instructionSteps)) invalid();
    if (Object.hasOwn(instructionSteps, language)) return parseSteps(instructionSteps[language]);
  }
  const instructions = record.instructions;
  if (!isJsonRecord(instructions)) invalid();
  return [parseText(instructions[language], MAX_STEP_CHARACTERS)];
}

function parseRecord(value: unknown): ExternalExerciseCatalogItem {
  if (!isJsonRecord(value)) invalid();
  const upstreamId = value.id;
  if (typeof upstreamId !== 'string' || !/^\d{4}$/.test(upstreamId)) invalid();
  const secondaryMuscles = value.secondary_muscles;
  if (!Array.isArray(secondaryMuscles) || secondaryMuscles.length > MAX_SECONDARY_MUSCLES) invalid();
  const en = parseLanguageInstructions(value, 'en');
  const zh = parseLanguageInstructions(value, 'zh');
  if (en.concat(zh).reduce((total, step) => total + characterCount(step), 0) > MAX_TOTAL_STEP_CHARACTERS) invalid();
  return {
    upstreamId,
    name: parseText(value.name, MAX_CLASSIFICATION_CHARACTERS),
    bodyPart: parseText(value.body_part, MAX_CLASSIFICATION_CHARACTERS),
    equipment: parseText(value.equipment, MAX_CLASSIFICATION_CHARACTERS),
    target: parseText(value.target, MAX_CLASSIFICATION_CHARACTERS),
    secondaryMuscles: secondaryMuscles.map((muscle) => parseText(muscle, MAX_SECONDARY_MUSCLE_CHARACTERS)),
    instructions: { en, zh },
    safetyReview: 'UNREVIEWED',
  };
}

export function parseExternalExerciseCatalog(
  input: { records: unknown; revision: string },
): ExternalExerciseCatalog {
  try {
    if (!isJsonRecord(input) || !isJsonCompatible(input)) invalid();
    if (!/^[0-9a-f]{40}$/i.test(input.revision)) invalid();
    if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > MAX_RECORDS) invalid();
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_INPUT_BYTES) invalid();
    const items = input.records.map(parseRecord);
    if (new Set(items.map((item) => item.upstreamId)).size !== items.length) invalid();
    return { sourceId, revision: input.revision, license, items };
  } catch {
    throw new Error(EXTERNAL_EXERCISE_CATALOG_INVALID);
  }
}
