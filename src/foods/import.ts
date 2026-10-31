import { Prisma, PrismaClient } from '@prisma/client';
import { normalizeName } from './normalize';
import { validateFoodValues, type FoodValues } from './validate';

export function parseCsv(text: string, delim = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; rows.push(row); row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/**
 * "12,5" → 12.5. Vazio, NA, ND, "*" e "-" → null (não informado).
 * "Tr" (traços) → 0, convenção usada nas tabelas brasileiras. Valor inválido ou negativo lança erro.
 */
export function parseDecimal(raw: string | undefined): number | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (['', 'na', 'nd', '*', '-'].includes(s)) return null;
  if (s === 'tr') return 0;
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error('valor_invalido');
  if (n < 0) throw new Error('valor_negativo');
  return n;
}

const MAIN = { energyKcal: 'energia_kcal', proteinG: 'proteina_g', carbG: 'carboidrato_g', fatG: 'lipidios_g', fiberG: 'fibra_g' } as const;
const MICROS = ['calcio_mg', 'ferro_mg', 'sodio_mg', 'vitamina_c_mg'] as const;

export interface ImportInput {
  code: string; // TACO, TBCA...
  name: string;
  version: string;
  sourceUrl?: string;
  /** Condições de uso confirmadas. Sem isso a importação é recusada. */
  license: string;
  csv: string;
  /** Quantidade de registros da fonte, para conferência. */
  expectedCount?: number;
}

export interface ImportReport {
  table: string;
  version: string;
  sourceRows: number;
  imported: number;
  updated: number;
  rejected: { line: number; code: string | null; reason: string }[];
  warnings: { line: number; code: string; warnings: string[] }[];
  /** importados + atualizados + rejeitados = linhas da fonte */
  reconciled: boolean;
  matchesExpected: boolean | null;
}

/** Idempotente: reexecutar o mesmo arquivo atualiza em vez de duplicar. Roda como dono do schema. */
export async function importFoodTable(db: PrismaClient, input: ImportInput): Promise<ImportReport> {
  if (!input.license?.trim()) throw new Error('license_required');
  const rows = parseCsv(input.csv);
  const header = (rows[0] ?? []).map((h) => normalizeName(h).replace(/ /g, '_'));
  const idx = (name: string) => header.indexOf(name);
  if (idx('codigo') < 0 || idx('nome') < 0) throw new Error('cabecalho_invalido: faltam codigo/nome');

  const table = await db.foodTable.upsert({
    where: { code: input.code },
    create: { code: input.code, name: input.name, version: input.version, sourceUrl: input.sourceUrl, license: input.license },
    update: { name: input.name, version: input.version, sourceUrl: input.sourceUrl, license: input.license },
  });
  const existing = new Set(
    (await db.food.findMany({ where: { tableId: table.id }, select: { externalCode: true } })).map((f) => f.externalCode),
  );

  const report: ImportReport = {
    table: input.code, version: input.version, sourceRows: 0, imported: 0, updated: 0,
    rejected: [], warnings: [], reconciled: false, matchesExpected: null,
  };
  const accepted: Prisma.FoodCreateInput[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.every((c) => c.trim() === '')) continue;
    report.sourceRows++;
    const line = i + 1;
    const code = (cells[idx('codigo')] ?? '').trim();
    const name = (cells[idx('nome')] ?? '').trim();
    const reject = (reason: string) => report.rejected.push({ line, code: code || null, reason });

    if (!code) { reject('codigo_ausente'); continue; }
    if (!name) { reject('nome_ausente'); continue; }
    if (seen.has(code)) { reject('codigo_duplicado'); continue; }

    let values: FoodValues = {};
    const micros: Record<string, number> = {};
    try {
      values = Object.fromEntries(
        Object.entries(MAIN).map(([k, col]) => [k, idx(col) >= 0 ? parseDecimal(cells[idx(col)]) : null]),
      ) as FoodValues;
      for (const m of MICROS) {
        const v = idx(m) >= 0 ? parseDecimal(cells[idx(m)]) : null;
        if (v !== null) micros[m] = v;
      }
    } catch (e) {
      reject((e as Error).message);
      continue;
    }
    const v = validateFoodValues(values);
    if (v.errors.length) { reject(v.errors.join(',')); continue; }
    if (v.warnings.length) report.warnings.push({ line, code, warnings: v.warnings });

    seen.add(code);
    accepted.push({
      table: { connect: { id: table.id } }, externalCode: code, name, normalizedName: normalizeName(name),
      energyKcal: values.energyKcal, proteinG: values.proteinG, carbG: values.carbG, fatG: values.fatG, fiberG: values.fiberG,
      micros: Object.keys(micros).length ? micros : Prisma.DbNull,
    });
  }

  for (let i = 0; i < accepted.length; i += 200) {
    const chunk = accepted.slice(i, i + 200);
    await db.$transaction(
      chunk.map((f) => {
        const { table: _t, ...data } = f;
        return db.food.upsert({
          where: { tableId_externalCode: { tableId: table.id, externalCode: f.externalCode! } },
          create: f,
          update: data,
        });
      }),
    );
  }
  for (const f of accepted) existing.has(f.externalCode!) ? report.updated++ : report.imported++;

  report.reconciled = report.imported + report.updated + report.rejected.length === report.sourceRows;
  if (input.expectedCount !== undefined) report.matchesExpected = input.expectedCount === report.sourceRows;
  return report;
}

export interface ReferenceSample extends FoodValues {
  code: string;
}

/** Confere uma amostra de referência (valores da fonte) com o que está no banco. Tolerância relativa (padrão 0,1%). */
export async function verifyReferenceSample(db: PrismaClient, tableCode: string, sample: ReferenceSample[], tolerance = 0.001) {
  const mismatches: { code: string; field: string; expected: number; actual: number | null }[] = [];
  for (const s of sample) {
    const food = await db.food.findFirst({ where: { externalCode: s.code, table: { code: tableCode } } });
    if (!food) { mismatches.push({ code: s.code, field: 'missing', expected: 0, actual: null }); continue; }
    for (const k of ['energyKcal', 'proteinG', 'carbG', 'fatG', 'fiberG'] as const) {
      const expected = s[k];
      if (expected === undefined || expected === null) continue;
      const actual = food[k] === null ? null : Number(food[k]);
      if (actual === null || Math.abs(actual - expected) > Math.max(Math.abs(expected) * tolerance, 1e-6)) {
        mismatches.push({ code: s.code, field: k, expected, actual });
      }
    }
  }
  return mismatches;
}
