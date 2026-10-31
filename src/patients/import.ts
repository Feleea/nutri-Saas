import { PrismaClient } from '@prisma/client';
import type { SessionInfo } from '../auth/service';
import { accessMode } from '../billing/limits';
import { forTenant, withTenant } from '../db/tenant';
import { normalizeName } from '../foods/normalize';
import { normalizeCpf, normalizeTags, validatePatientInput } from './validate';

export const MAX_PATIENT_IMPORT_ROWS = 200;
export const MAX_PATIENT_IMPORT_CHARACTERS = 1_000_000;

const CLINICAL = new Set(['TITULAR', 'PROFISSIONAL']);
const FIELD_ALIASES: Record<string, keyof PatientCsvRow> = {
  nome: 'fullName', name: 'fullName', fullname: 'fullName',
  email: 'email', 'e-mail': 'email',
  telefone: 'phone', phone: 'phone', celular: 'phone', whatsapp: 'phone',
  cpf: 'cpf',
  objetivo: 'goal', goal: 'goal',
  etiquetas: 'tags', tags: 'tags',
};

export interface PatientCsvRow {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  cpf?: string | null;
  goal?: string | null;
  tags?: string[] | null;
}

interface ParsedRow {
  row: number;
  input: PatientCsvRow;
  errors: string[];
}

interface CsvRecord {
  row: number;
  cells: string[];
}

function parseCsv(csv: string): { records?: CsvRecord[]; error?: string } {
  if (!csv.trim()) return { error: 'csv_empty' };
  if (csv.length > MAX_PATIENT_IMPORT_CHARACTERS) return { error: 'csv_too_large' };

  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;
  let hasContent = false;

  const finishCell = () => {
    cells.push(cell);
    cell = '';
    afterQuote = false;
  };
  const finishRecord = () => {
    finishCell();
    if (cells.some((value) => value.trim())) records.push({ row: recordLine, cells });
    cells = [];
    hasContent = false;
    recordLine = line + 1;
  };

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        cell += char;
        if (char === '\n') line++;
        else if (char === '\r' && csv[i + 1] !== '\n') line++;
      }
      hasContent = true;
      continue;
    }

    if (afterQuote && char !== ',' && char !== '\r' && char !== '\n' && char !== ' ' && char !== '\t') {
      return { error: 'csv_invalid' };
    }
    if (char === '"' && !cell && !afterQuote) {
      quoted = true;
      hasContent = true;
    } else if (char === ',' ) {
      finishCell();
      hasContent = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && csv[i + 1] === '\n') i++;
      finishRecord();
      line++;
      recordLine = line;
    } else if (afterQuote && (char === ' ' || char === '\t')) {
      // Ignore whitespace between a closing quote and the next delimiter.
    } else {
      if (char === '"') return { error: 'csv_invalid' };
      cell += char;
      if (char.trim()) hasContent = true;
    }
  }
  if (quoted) return { error: 'csv_invalid' };
  if (hasContent || cells.length || cell) finishRecord();
  if (!records.length) return { error: 'csv_empty' };
  return { records };
}

function mapHeaders(headers: string[]): { fields?: Array<keyof PatientCsvRow | null>; error?: string } {
  const fields: Array<keyof PatientCsvRow | null> = [];
  const seen = new Set<keyof PatientCsvRow>();
  for (const raw of headers) {
    const header = normalizeName(raw.replace(/^\uFEFF/, '').trim()).replace(/\s+/g, '');
    const field = FIELD_ALIASES[header] ?? FIELD_ALIASES[raw.trim().toLowerCase()];
    if (!field || seen.has(field)) return { error: 'header_invalid' };
    seen.add(field);
    fields.push(field);
  }
  if (!seen.has('fullName')) return { error: 'header_name_required' };
  return { fields };
}

export function parsePatientCsv(csv: string): { rows?: ParsedRow[]; error?: string } {
  const parsed = parseCsv(csv);
  if (!parsed.records) return { error: parsed.error };
  const [headerRecord, ...data] = parsed.records;
  const mapped = mapHeaders(headerRecord.cells);
  if (!mapped.fields) return { error: mapped.error };
  if (data.length > MAX_PATIENT_IMPORT_ROWS) return { error: 'too_many_rows' };

  const rows: ParsedRow[] = data.map((record) => {
    if (record.cells.length !== mapped.fields!.length) {
      return { row: record.row, input: { fullName: '' }, errors: ['column_count'] };
    }
    const values: Partial<Record<keyof PatientCsvRow, string>> = {};
    record.cells.forEach((value, i) => {
      const field = mapped.fields![i];
      if (field) values[field] = value.trim();
    });
    const input: PatientCsvRow = {
      fullName: values.fullName ?? '',
      email: values.email || null,
      phone: values.phone || null,
      cpf: values.cpf || null,
      goal: values.goal || null,
      tags: values.tags ? values.tags.split(/[;|]/).map((tag) => tag.trim()).filter(Boolean) : [],
    };
    return { row: record.row, input, errors: validatePatientInput(input, 'create') };
  });
  if (!rows.length) return { error: 'csv_no_rows' };
  return { rows };
}

export interface PatientImportPreview {
  ok: true;
  rows: Array<{ row: number; patient: PatientCsvRow; errors: string[] }>;
  duplicateRows: number[];
  validCount: number;
}

interface Deps {
  db: PrismaClient;
  now?: () => Date;
}

export function createPatientImportService({ db, now = () => new Date() }: Deps) {
  async function preview(session: SessionInfo, csv: string): Promise<PatientImportPreview | { ok: false; reason: string }> {
    if (!CLINICAL.has(session.role)) return { ok: false, reason: 'forbidden' };
    const parsed = parsePatientCsv(csv);
    if (!parsed.rows) return { ok: false, reason: parsed.error ?? 'csv_invalid' };

    const cpfRows = new Map<string, number[]>();
    for (const row of parsed.rows) {
      const cpf = row.input.cpf?.trim() ? normalizeCpf(row.input.cpf) : null;
      if (cpf && !row.errors.includes('cpf_invalid')) cpfRows.set(cpf, [...(cpfRows.get(cpf) ?? []), row.row]);
    }
    const cpfs = [...cpfRows.keys()];
    const existing = cpfs.length
      ? await forTenant(session.accountId, session.userId, db).patient.findMany({
        where: { cpf: { in: cpfs } }, select: { cpf: true },
      })
      : [];
    const existingCpfs = new Set(existing.map((patient) => patient.cpf).filter((cpf): cpf is string => Boolean(cpf)));
    const duplicateRows = new Set<number>();
    for (const [cpf, rowNumbers] of cpfRows) {
      if (existingCpfs.has(cpf) || rowNumbers.length > 1) rowNumbers.forEach((row) => duplicateRows.add(row));
    }
    return {
      ok: true,
      rows: parsed.rows.map(({ row, input, errors }) => ({ row, patient: input, errors })),
      duplicateRows: [...duplicateRows].sort((a, b) => a - b),
      validCount: parsed.rows.filter((row) => row.errors.length === 0).length,
    };
  }

  async function confirm(
    session: SessionInfo,
    csv: string,
    confirmDuplicates: boolean,
  ): Promise<{ ok: true; imported: number } | { ok: false; reason: string; errors?: string[]; rows?: number[]; limit?: number | null; count?: number }> {
    const previewResult = await preview(session, csv);
    if (!previewResult.ok) return previewResult;
    const invalidRows = previewResult.rows.filter((row) => row.errors.length).map((row) => row.row);
    if (invalidRows.length) return { ok: false, reason: 'validation', rows: invalidRows };
    if (previewResult.duplicateRows.length && !confirmDuplicates) {
      return { ok: false, reason: 'duplicate_cpf', rows: previewResult.duplicateRows };
    }

    const parsed = parsePatientCsv(csv);
    if (!parsed.rows) return { ok: false, reason: parsed.error ?? 'csv_invalid' };
    type ImportOutcome =
      | { reason: 'access_restricted' }
      | { reason: 'patient_limit'; limit: number | null; count: number }
      | { reason: 'duplicate_cpf'; rows: number[] }
      | { imported: number };
    const imported = await withTenant<ImportOutcome>(session.accountId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${session.accountId}))`;
      const account = await tx.account.findUniqueOrThrow({ where: { id: session.accountId } });
      const subscription = await tx.subscription.findUnique({ where: { accountId: session.accountId }, include: { plan: true } });
      const count = await tx.patient.count({ where: { status: 'ACTIVE' } });
      const mode = accessMode(
        { accountStatus: account.status, trialEndsAt: account.trialEndsAt, graceEndsAt: subscription?.graceEndsAt ?? null },
        now(),
      );
      if (mode !== 'FULL') return { reason: 'access_restricted' as const };
      const limit = subscription?.plan.patientLimit ?? null;
      if (limit !== null && count + parsed.rows!.length > limit) {
        return { reason: 'patient_limit' as const, limit, count };
      }

      const cpfs = parsed.rows!.map(({ input }) => input.cpf?.trim() ? normalizeCpf(input.cpf) : null).filter((cpf): cpf is string => Boolean(cpf));
      const existing = cpfs.length ? await tx.patient.findMany({ where: { cpf: { in: cpfs } }, select: { cpf: true } }) : [];
      const existingCpfs = new Set(existing.map((patient) => patient.cpf).filter((cpf): cpf is string => Boolean(cpf)));
      const duplicateRows = new Set<number>();
      const rowsByCpf = new Map<string, number[]>();
      parsed.rows!.forEach(({ row, input }) => {
        const cpf = input.cpf?.trim() ? normalizeCpf(input.cpf) : null;
        if (cpf) rowsByCpf.set(cpf, [...(rowsByCpf.get(cpf) ?? []), row]);
      });
      for (const [cpf, rowNumbers] of rowsByCpf) {
        if (existingCpfs.has(cpf) || rowNumbers.length > 1) rowNumbers.forEach((row) => duplicateRows.add(row));
      }
      if (duplicateRows.size && !confirmDuplicates) return { reason: 'duplicate_cpf' as const, rows: [...duplicateRows] };

      for (const { input } of parsed.rows!) {
        const createdAt = now();
        const patient = await tx.patient.create({
          data: {
            accountId: session.accountId,
            fullName: input.fullName.trim(),
            normalizedName: normalizeName(input.fullName),
            email: input.email?.trim() || null,
            phone: input.phone?.trim() || null,
            cpf: input.cpf?.trim() ? normalizeCpf(input.cpf) : null,
            goal: input.goal?.trim() || null,
            tags: normalizeTags(input.tags),
            createdAt,
            lastActivityAt: createdAt,
          },
        });
        await tx.auditLog.create({
          data: {
            accountId: session.accountId,
            actorUserId: session.userId,
            action: 'PATIENT_CREATED',
            resource: 'Patient',
            resourceId: patient.id,
            createdAt,
          },
        });
      }
      return { imported: parsed.rows!.length };
    }, db);

    if ('reason' in imported) return { ok: false, ...imported };
    return { ok: true, imported: imported.imported };
  }

  return { preview, confirm };
}
