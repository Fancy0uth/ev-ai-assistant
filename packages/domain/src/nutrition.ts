export const DECIMAL_MICRO_SCALE = 1_000_000n;
export const MAX_CANONICAL_DECIMAL_MICROS = 999_999_999_999n;

const canonicalDecimalPattern = /^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{0,5}[1-9])?$/;

export interface DecimalNutrientTotals {
  energyKcalDecimal: string;
  proteinGramsDecimal: string;
  carbohydrateGramsDecimal: string;
  fatGramsDecimal: string;
}

export function parseCanonicalDecimalToMicros(value: string): bigint {
  const match = canonicalDecimalPattern.exec(value);
  if (!match) throw new RangeError('DECIMAL_NON_CANONICAL');
  const [integerPart, fractional = ''] = value.split('.');
  if (!integerPart) throw new RangeError('DECIMAL_NON_CANONICAL');
  const micros = BigInt(integerPart) * DECIMAL_MICRO_SCALE + BigInt(fractional.padEnd(6, '0') || '0');
  if (micros > MAX_CANONICAL_DECIMAL_MICROS) throw new RangeError('DECIMAL_OUT_OF_RANGE');
  return micros;
}

export function formatCanonicalDecimalFromMicros(value: bigint): string {
  if (value < 0n) throw new RangeError('DECIMAL_NEGATIVE');
  if (value > MAX_CANONICAL_DECIMAL_MICROS) throw new RangeError('DECIMAL_OUT_OF_RANGE');
  const integerPart = value / DECIMAL_MICRO_SCALE;
  const fractionalPart = (value % DECIMAL_MICRO_SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return fractionalPart.length === 0 ? integerPart.toString() : `${integerPart}.${fractionalPart}`;
}

export function scaleNutrientV1(perServing: string, quantity: string, servingQuantity: string): string {
  const nutrient = parseCanonicalDecimalToMicros(perServing);
  const selected = parseCanonicalDecimalToMicros(quantity);
  const basis = parseCanonicalDecimalToMicros(servingQuantity);
  if (basis <= 0n) throw new RangeError('SERVING_QUANTITY_MUST_BE_POSITIVE');
  const scaled = (nutrient * selected + basis / 2n) / basis;
  if (scaled > MAX_CANONICAL_DECIMAL_MICROS) throw new RangeError('DECIMAL_OUT_OF_RANGE');
  return formatCanonicalDecimalFromMicros(scaled);
}

export function calculateMealTotalsV1(entries: readonly DecimalNutrientTotals[]): DecimalNutrientTotals {
  let energyKcalMicros = 0n;
  let proteinGramsMicros = 0n;
  let carbohydrateGramsMicros = 0n;
  let fatGramsMicros = 0n;
  for (const entry of entries) {
    energyKcalMicros += parseCanonicalDecimalToMicros(entry.energyKcalDecimal);
    proteinGramsMicros += parseCanonicalDecimalToMicros(entry.proteinGramsDecimal);
    carbohydrateGramsMicros += parseCanonicalDecimalToMicros(entry.carbohydrateGramsDecimal);
    fatGramsMicros += parseCanonicalDecimalToMicros(entry.fatGramsDecimal);
    if (energyKcalMicros > MAX_CANONICAL_DECIMAL_MICROS
      || proteinGramsMicros > MAX_CANONICAL_DECIMAL_MICROS
      || carbohydrateGramsMicros > MAX_CANONICAL_DECIMAL_MICROS
      || fatGramsMicros > MAX_CANONICAL_DECIMAL_MICROS) {
      throw new RangeError('DECIMAL_OUT_OF_RANGE');
    }
  }
  return {
    energyKcalDecimal: formatCanonicalDecimalFromMicros(energyKcalMicros),
    proteinGramsDecimal: formatCanonicalDecimalFromMicros(proteinGramsMicros),
    carbohydrateGramsDecimal: formatCanonicalDecimalFromMicros(carbohydrateGramsMicros),
    fatGramsDecimal: formatCanonicalDecimalFromMicros(fatGramsMicros),
  };
}
