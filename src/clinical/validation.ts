import { z } from 'zod';

const optionSchema = z.string().trim().min(1).max(80);

export const templateFieldSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
  label: z.string().trim().min(1).max(160),
  type: z.enum(['text', 'number', 'single', 'multiple', 'date']),
  required: z.boolean().default(false),
  options: z.array(optionSchema).min(2).max(30).optional(),
}).strict().superRefine((field, ctx) => {
  const choice = field.type === 'single' || field.type === 'multiple';
  if (choice && !field.options) ctx.addIssue({ code: 'custom', message: 'choices_required', path: ['options'] });
  if (!choice && field.options) ctx.addIssue({ code: 'custom', message: 'choices_not_allowed', path: ['options'] });
  if (field.options && new Set(field.options).size !== field.options.length) {
    ctx.addIssue({ code: 'custom', message: 'choices_must_be_unique', path: ['options'] });
  }
});

export const templateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  fields: z.array(templateFieldSchema).min(1).max(60),
}).strict().superRefine(({ fields }, ctx) => {
  if (new Set(fields.map((field) => field.id)).size !== fields.length) {
    ctx.addIssue({ code: 'custom', message: 'field_ids_must_be_unique', path: ['fields'] });
  }
});

export const templatePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  fields: z.array(templateFieldSchema).min(1).max(60).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.name === undefined && input.fields === undefined) {
    ctx.addIssue({ code: 'custom', message: 'empty_update' });
  }
  if (input.fields && new Set(input.fields.map((field) => field.id)).size !== input.fields.length) {
    ctx.addIssue({ code: 'custom', message: 'field_ids_must_be_unique', path: ['fields'] });
  }
});

export const anamnesisBodySchema = z.object({
  templateId: z.string().min(1).max(64),
  answers: z.record(z.unknown()),
  status: z.enum(['DRAFT', 'COMPLETED']).default('DRAFT'),
}).strict();

export const anamnesisPatchSchema = z.object({
  answers: z.record(z.unknown()).optional(),
  status: z.enum(['DRAFT', 'COMPLETED']).optional(),
}).strict().refine((input) => input.answers !== undefined || input.status !== undefined, 'empty_update');

const optionalMeasure = z.number().finite().nullable().optional();
const bioimpedanceSchema = z.object({
  method: z.literal('BIOIMPEDANCE'),
  bodyFatPercent: z.number().finite().min(0).max(75),
  deviceModel: z.string().trim().min(1).max(100).optional(),
}).strict();
const skinfoldSchema = z.object({
  method: z.literal('JACKSON_POLLOCK_3_SITE'),
  sexAtBirth: z.enum(['male', 'female']),
  ageYears: z.number().int().min(18).max(100),
  chestMm: z.number().finite().min(2).max(80).optional(),
  abdomenMm: z.number().finite().min(2).max(80).optional(),
  thighMm: z.number().finite().min(2).max(80).optional(),
  tricepsMm: z.number().finite().min(2).max(80).optional(),
  suprailiacMm: z.number().finite().min(2).max(80).optional(),
}).strict().superRefine((input, ctx) => {
  const required = input.sexAtBirth === 'male'
    ? ['chestMm', 'abdomenMm', 'thighMm'] as const
    : ['tricepsMm', 'suprailiacMm', 'thighMm'] as const;
  for (const field of required) {
    if (input[field] === undefined) {
      ctx.addIssue({ code: 'custom', message: 'skinfold_required', path: [field] });
    }
  }
  const unused = input.sexAtBirth === 'male' ? ['tricepsMm', 'suprailiacMm'] as const : ['chestMm', 'abdomenMm'] as const;
  for (const field of unused) {
    if (input[field] !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'skinfold_not_used_by_formula', path: [field] });
    }
  }
});
export const bodyCompositionSchema = z.union([
  bioimpedanceSchema,
  skinfoldSchema,
]);

export const anthropometryBodySchema = z.object({
  measuredAt: z.string().datetime({ offset: true }).optional(),
  weight: z.number().finite(),
  weightUnit: z.enum(['kg', 'lb']).default('kg'),
  height: z.number().finite(),
  heightUnit: z.enum(['cm', 'm']).default('cm'),
  waistCm: optionalMeasure,
  hipCm: optionalMeasure,
  neckCm: optionalMeasure,
  armCm: optionalMeasure,
  thighCm: optionalMeasure,
  bodyComposition: bodyCompositionSchema.optional(),
}).strict();

export type TemplateField = z.infer<typeof templateFieldSchema>;
export type TemplateBody = z.infer<typeof templateBodySchema>;
export type TemplatePatch = z.infer<typeof templatePatchSchema>;
export type AnamnesisBody = z.infer<typeof anamnesisBodySchema>;
export type AnamnesisPatch = z.infer<typeof anamnesisPatchSchema>;
export type AnthropometryBody = z.infer<typeof anthropometryBodySchema>;
export type BodyCompositionInput = z.infer<typeof bodyCompositionSchema>;
