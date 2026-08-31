export const DECIMAL_MICRO_SCALE = 1_000_000n;

const canonicalDecimalPattern = /^(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$/;

export interface DecimalNutrientTotals {
  energyKcalDecimal: string;
  proteinGramsDecimal: string;
  carbohydrateGramsDecimal: string;
  fatGramsDecimal: string;
}

export function parseCanonicalDecimalToMicros(value: string): bigint {
  const match = canonicalDecimalPattern.exec(value);
  if (!match) throw new RangeError('DECIMAL_NON_CANONICAL');
  const integerPart = match[1];
  const fractionalPart = (match[2] ?? '').slice(1).padEnd(6, '0');
  if (!integerPart) throw new RangeError('DECIMAL_NON_CANONICAL');
  return BigInt(integerPart) * DECIMAL_MICRO_SCALE + BigInt(fractionalPart || '0');
}

export function formatCanonicalDecimalFromMicros(value: bigint): string {
  if (value < 0n) throw new RangeError('DECIMAL_NEGATIVE');
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
  }
  return {
    energyKcalDecimal: formatCanonicalDecimalFromMicros(energyKcalMicros),
    proteinGramsDecimal: formatCanonicalDecimalFromMicros(proteinGramsMicros),
    carbohydrateGramsDecimal: formatCanonicalDecimalFromMicros(carbohydrateGramsMicros),
    fatGramsDecimal: formatCanonicalDecimalFromMicros(fatGramsMicros),
  };
}
