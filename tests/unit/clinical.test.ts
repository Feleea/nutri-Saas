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
    expect(normalizeAnthropometry(input)).not.toHaveProperty('classification');
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
