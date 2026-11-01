import { describe, expect, it } from 'vitest';
import { normalizeAnthropometry } from '../../src/clinical/service';
import { anthropometryBodySchema, templateBodySchema } from '../../src/clinical/validation';

describe('antropometria clínica', () => {
  it('calcula IMC em kg/cm e arredonda para uma casa decimal', () => {
    const input = anthropometryBodySchema.parse({ weight: 70, height: 175 });
    expect(normalizeAnthropometry(input)).toMatchObject({ ok: true, weightKg: 70, heightCm: 175, bmi: 22.9 });
  });

  it('converte lb e m para as unidades padrão armazenadas', () => {
    const input = anthropometryBodySchema.parse({ weight: 154.323583, weightUnit: 'lb', height: 1.75, heightUnit: 'm' });
    expect(normalizeAnthropometry(input)).toMatchObject({ ok: true, weightKg: 70, heightCm: 175, bmi: 22.9 });
  });

  it.each([
    [{ weight: 0.9, height: 175 }, 'weight_out_of_range'],
    [{ weight: 501, height: 175 }, 'weight_out_of_range'],
    [{ weight: 70, height: 29 }, 'height_out_of_range'],
    [{ weight: 70, height: 175, waistCm: 301 }, 'measure_out_of_range'],
  ])('recusa valores antropométricos implausíveis: %j', (body, error) => {
    const input = anthropometryBodySchema.parse(body);
    expect(normalizeAnthropometry(input)).toMatchObject({ ok: false, errors: [error] });
  });

  it('não classifica IMC sem idade e curva pediátrica disponíveis', () => {
    const input = anthropometryBodySchema.parse({ weight: 45, height: 150 });
    expect(normalizeAnthropometry(input)).toMatchObject({ bodyComposition: null });
    expect(normalizeAnthropometry(input)).not.toHaveProperty('classification');
  });

  it('uses the entered bioimpedance reading and derives masses without estimating a percentage', () => {
    const input = anthropometryBodySchema.parse({
      weight: 80, height: 180,
      bodyComposition: { method: 'BIOIMPEDANCE', bodyFatPercent: 25, deviceModel: 'Device X' },
    });
    expect(normalizeAnthropometry(input)).toMatchObject({
      ok: true,
      bodyComposition: {
        method: 'BIOIMPEDANCE',
        formula: expect.stringContaining('sem equação estimada'),
        rawInputs: { bodyFatPercent: 25, deviceModel: 'Device X' },
        derivedValues: { bodyFatPercent: 25, fatMassKg: 20, fatFreeMassKg: 60 },
      },
    });
  });

  it('calculates adult Jackson–Pollock male three-site percentage and records its raw inputs/formula', () => {
    const input = anthropometryBodySchema.parse({
      weight: 80, height: 180,
      bodyComposition: {
        method: 'JACKSON_POLLOCK_3_SITE', sexAtBirth: 'male', ageYears: 30,
        chestMm: 10, abdomenMm: 20, thighMm: 15,
      },
    });
    const result = normalizeAnthropometry(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bodyComposition?.method).toBe('JACKSON_POLLOCK_3_SITE');
      expect(result.bodyComposition?.formula).toContain('495/DC − 450');
      expect(result.bodyComposition?.rawInputs).toMatchObject({
        sexAtBirth: 'male', ageYears: 30, chestMm: 10, abdomenMm: 20, thighMm: 15,
      });
      expect(result.bodyComposition?.derivedValues.bodyFatPercent).toBe(13.6);
      expect(result.bodyComposition?.derivedValues.fatMassKg).toBe(10.88);
      expect(result.bodyComposition?.derivedValues.fatFreeMassKg).toBe(69.12);
    }
  });

  it('uses the female three-site equation and Siri conversion', () => {
    const input = anthropometryBodySchema.parse({
      weight: 80, height: 180,
      bodyComposition: {
        method: 'JACKSON_POLLOCK_3_SITE', sexAtBirth: 'female', ageYears: 30,
        tricepsMm: 15, suprailiacMm: 20, thighMm: 25,
      },
    });
    const result = normalizeAnthropometry(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bodyComposition?.formula).toContain('1.0994921');
      expect(result.bodyComposition?.derivedValues.bodyFatPercent).toBe(24.1);
      expect(result.bodyComposition?.derivedValues.fatMassKg).toBe(19.28);
    }
  });

  it('does not accept missing/irrelevant skinfolds, pediatric ages, or unsupported percentages', () => {
    expect(anthropometryBodySchema.safeParse({
      weight: 70, height: 175,
      bodyComposition: { method: 'JACKSON_POLLOCK_3_SITE', sexAtBirth: 'female', ageYears: 17, thighMm: 20 },
    }).success).toBe(false);
    expect(anthropometryBodySchema.safeParse({
      weight: 70, height: 175,
      bodyComposition: { method: 'JACKSON_POLLOCK_3_SITE', sexAtBirth: 'female', ageYears: 30, thighMm: 20 },
    }).success).toBe(false);
    expect(anthropometryBodySchema.safeParse({
      weight: 70, height: 175,
      bodyComposition: {
        method: 'JACKSON_POLLOCK_3_SITE', sexAtBirth: 'male', ageYears: 30,
        chestMm: 10, abdomenMm: 20, thighMm: 15, tricepsMm: 12,
      },
    }).success).toBe(false);
    expect(anthropometryBodySchema.safeParse({
      weight: 70, height: 175, bodyComposition: { method: 'BIOIMPEDANCE', bodyFatPercent: 80 },
    }).success).toBe(false);
  });
});

describe('modelos versionados de anamnese', () => {
  it('aceita os cinco tipos de campo e opções para escolhas', () => {
    const parsed = templateBodySchema.safeParse({
      name: 'Consulta inicial',
      fields: [
        { id: 'historia', label: 'História', type: 'text', required: true },
        { id: 'frequencia', label: 'Frequência', type: 'number' },
        { id: 'objetivo', label: 'Objetivo', type: 'single', options: ['Saúde', 'Esporte'] },
        { id: 'sintomas', label: 'Sintomas', type: 'multiple', options: ['Azia', 'Dor'] },
        { id: 'inicio', label: 'Início', type: 'date' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejeita identificadores duplicados e escolhas sem opções', () => {
    expect(templateBodySchema.safeParse({
      name: 'Modelo',
      fields: [
        { id: 'x', label: 'Um', type: 'single' },
        { id: 'x', label: 'Dois', type: 'text' },
      ],
    }).success).toBe(false);
  });
});
