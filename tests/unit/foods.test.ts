import { describe, it, expect } from 'vitest';
import { normalizeName } from '../../src/foods/normalize';
import { expandTerm } from '../../src/foods/synonyms';
import { validateFoodValues, toPer100g } from '../../src/foods/validate';
import { offeredMeasures, toGrams } from '../../src/foods/measures';
import { parseCsv, parseDecimal } from '../../src/foods/import';

describe('US-ALI-02 · busca [unit]', () => {
  it('ignora acentos, maiúsculas e espaços extras', () => {
    expect(normalizeName('  FEIJÃO   Carioca ')).toBe('feijao carioca');
    expect(normalizeName('Arroz, integral')).toBe('arroz integral');
  });
  it('expande sinônimos regionais', () => {
    expect(expandTerm('mandioca')).toEqual(expect.arrayContaining(['mandioca', 'aipim', 'macaxeira']));
    expect(expandTerm('Aipim frito')).toContain('mandioca frito');
    expect(expandTerm('arroz')).toEqual(['arroz']);
  });
});

describe('US-ALI-03 · consistência dos valores [unit]', () => {
  it('aceita valores coerentes e trata nulo como "não informado"', () => {
    expect(validateFoodValues({ energyKcal: 124, proteinG: 2.6, carbG: 25.8, fatG: 1.0 })).toEqual({ errors: [], warnings: [] });
    expect(validateFoodValues({ energyKcal: null, proteinG: null })).toEqual({ errors: [], warnings: [] });
  });
  it('recusa negativos', () => {
    expect(validateFoodValues({ proteinG: -1 }).errors).toEqual(['proteinG_invalid']);
  });
  it('alerta macros acima de 100 g, energia implausível, fibra maior que carboidrato e energia incoerente', () => {
    expect(validateFoodValues({ proteinG: 60, carbG: 60 }).warnings).toContain('macros_exceed_100g');
    expect(validateFoodValues({ energyKcal: 1200 }).warnings).toContain('energy_implausible');
    expect(validateFoodValues({ carbG: 5, fiberG: 9 }).warnings).toContain('fiber_exceeds_carb');
    expect(validateFoodValues({ energyKcal: 100, proteinG: 60, carbG: 10, fatG: 10 }).warnings).toContain('energy_mismatch');
  });
  it('converte valores por porção para 100 g', () => {
    expect(toPer100g(15, 30)).toBe(50);
    expect(toPer100g(1, 3)).toBe(33.333);
    expect(() => toPer100g(1, 0)).toThrow();
  });
});

describe('US-ALI-04 · medidas caseiras [unit]', () => {
  it('converte medida em gramas', () => {
    expect(toGrams(2, { label: 'colher de sopa', grams: 15 })).toBe(30);
    expect(toGrams(150)).toBe(150);
  });
  it('alimento sem medida oferece apenas gramas', () => {
    expect(offeredMeasures([])).toEqual([{ label: 'g', grams: 1 }]);
  });
  it('recusa quantidade inválida', () => {
    expect(() => toGrams(-1)).toThrow();
  });
});

describe('US-ALI-01 · leitura da fonte [unit]', () => {
  it('interpreta decimal com vírgula e marcadores de ausência', () => {
    expect(parseDecimal('12,5')).toBe(12.5);
    expect(parseDecimal('NA')).toBeNull();
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('Tr')).toBe(0);
    expect(() => parseDecimal('abc')).toThrow('valor_invalido');
    expect(() => parseDecimal('-3')).toThrow('valor_negativo');
  });
  it('lê CSV com aspas, ponto e vírgula e quebras CRLF', () => {
    const rows = parseCsv('a;b\r\n"x;y";"he said ""hi"""\r\n');
    expect(rows[1]).toEqual(['x;y', 'he said "hi"']);
  });
});
