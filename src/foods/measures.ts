export interface Measure {
  label: string;
  grams: number;
}

export const GRAMS: Measure = { label: 'g', grams: 1 };

/** Gramas sempre disponível; medidas cadastradas vêm depois. Alimento sem medida não gera erro. */
export const offeredMeasures = (measures: Measure[]): Measure[] => [GRAMS, ...measures];

export function toGrams(quantity: number, measure: Measure = GRAMS): number {
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('quantidade inválida');
  return Number((quantity * measure.grams).toFixed(3));
}
