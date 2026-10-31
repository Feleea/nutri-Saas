import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { seedTenants } from '../../prisma/seed-data';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as confirmEmail } from '@/app/api/auth/confirm-email/route';
import { GET as me } from '@/app/api/me/route';
import { POST as createPatient } from '@/app/api/patients/route';
import { GET as getPatient } from '@/app/api/patients/[id]/route';
import { POST as revokeConsent } from '@/app/api/patients/[id]/consent/revoke/route';
import { GET as templates, POST as createTemplate } from '@/app/api/anamnesis/templates/route';
import { GET as getTemplate, PATCH as patchTemplate } from '@/app/api/anamnesis/templates/[id]/route';
import { GET as listAnamneses, POST as createAnamnesis } from '@/app/api/patients/[id]/anamnesis/route';
import { GET as getAnamnesis, PATCH as patchAnamnesis } from '@/app/api/patients/[id]/anamnesis/[recordId]/route';
import { GET as listAnthropometry, POST as createAnthropometry } from '@/app/api/patients/[id]/anthropometry/route';
import { call, cookieOf, tokenFrom } from './helpers';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const PASSWORD = 'Senha-Forte-123';
const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

async function tenant(prefix: string) {
  const email = uniqueEmail(prefix);
  await call(signup, { body: { accountName: prefix, userName: prefix, email, password: PASSWORD, acceptTerms: true, acceptPrivacy: true, acceptDpa: true } });
  await call(confirmEmail, { body: { token: tokenFrom(email, 'verify_email') } });
  const cookie = cookieOf(await call(login, { body: { email, password: PASSWORD } }), 'sn_session');
  const accountId = (await call(me, { method: 'GET', cookie })).json.accountId;
  const user = await owner.user.findUniqueOrThrow({ where: { email } });
  return { cookie, accountId, userId: user.id, email };
}

async function patient(cookie: string, fullName: string, consent = true) {
  const r = await call(createPatient, { cookie, body: { fullName, phone: '11999990000', consent } });
  return r.json.patient.id as string;
}

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await owner.$disconnect(); });

describe('API clínica · anamnese, consentimento e antropometria [api][seg]', () => {
  it('cria anamnese versionada, preserva o snapshot e audita a edição de outro profissional', async () => {
    const t = await tenant('ana-api');
    const patientId = await patient(t.cookie, 'Paciente clínico');
    const createdTemplate = await call(createTemplate, { cookie: t.cookie, body: {
      name: 'Avaliação inicial',
      fields: [{ id: 'motivo', label: 'Motivo da consulta', type: 'text', required: true }],
    } });
    expect(createdTemplate.status).toBe(201);
    const templateId = createdTemplate.json.template.id;

    const draft = await call(createAnamnesis, { cookie: t.cookie, params: { id: patientId }, body: {
      templateId, answers: {}, status: 'DRAFT',
    } });
    expect(draft.status).toBe(201);
    const recordId = draft.json.record.id;
    expect(draft.json.record).toMatchObject({ status: 'DRAFT', templateVersion: 1 });

    const updateTemplate = await call(patchTemplate, { method: 'PATCH', cookie: t.cookie, params: { id: templateId }, body: {
      name: 'Avaliação revisada',
      fields: [
        { id: 'motivo', label: 'Motivo atual', type: 'text', required: true },
        { id: 'frequencia', label: 'Frequência', type: 'number', required: false },
      ],
    } });
    expect(updateTemplate.json.version).toBe(2);
    const oldSnapshot = await call(getAnamnesis, { method: 'GET', cookie: t.cookie, params: { id: patientId, recordId } });
    expect(oldSnapshot.json.record.versionSnapshot).toMatchObject({
      name: 'Avaliação inicial', fields: [{ id: 'motivo', label: 'Motivo da consulta', required: true, type: 'text' }],
    });

    const edit = await call(patchAnamnesis, { method: 'PATCH', cookie: t.cookie, params: { id: patientId, recordId }, body: {
      answers: { motivo: 'Acompanhamento de rotina' }, status: 'COMPLETED',
    } });
    expect(edit.status).toBe(200);
    expect(edit.json.record).toMatchObject({ status: 'COMPLETED', templateVersion: 1 });

    const otherProfessional = { accountId: t.accountId, userId: 'profissional-segundo', role: 'PROFISSIONAL' as const };
    const changedBySecond = await (await import('@/src/server/context')).ctx().clinical.updateAnamnesis(
      otherProfessional, patientId, recordId, { answers: { motivo: 'Revisado por outro profissional' } },
    );
    expect(changedBySecond.ok).toBe(true);
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { accountId: t.accountId, action: 'ANAMNESIS_UPDATED', resourceId: recordId, actorUserId: 'profissional-segundo' },
    });
    expect(audit).toMatchObject({ resource: 'AnamnesisRecord' });

    const history = await call(getTemplate, { method: 'GET', cookie: t.cookie, params: { id: templateId } });
    expect(history.json.template.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect((await call(templates, { method: 'GET', cookie: t.cookie })).status).toBe(200);
    expect((await call(listAnamneses, { method: 'GET', cookie: t.cookie, params: { id: patientId } })).json.items).toHaveLength(1);
    const stored = await owner.anamnesisRecord.findUniqueOrThrow({ where: { id: recordId } });
    expect(stored.legacyAnswers).toBeNull();
    expect(stored.answersCiphertext).not.toContain('Revisado por outro profissional');
    expect(JSON.stringify(stored)).not.toContain('Revisado por outro profissional');
    const clinicalSession = { accountId: t.accountId, userId: t.userId, role: 'TITULAR' as const };
    const exported = await (await import('@/src/server/context')).ctx().lgpd.exportPatient(clinicalSession, patientId);
    if (!exported.ok) throw new Error('exportação clínica falhou');
    const downloaded = await (await import('@/src/server/context')).ctx().lgpd.downloadExport(clinicalSession, exported.token);
    if (!downloaded.ok) throw new Error('download clínico falhou');
    expect(JSON.parse(downloaded.content).secoes['registros-clinicos'].anamneses[0].answers).toEqual({
      motivo: 'Revisado por outro profissional',
    });
  });

  it('bloqueia leitura e gravação clínica sem consentimento, revogado ou de outro tenant', async () => {
    const a = await tenant('ana-a');
    const b = await tenant('ana-b');
    const patientA = await patient(a.cookie, 'Consentimento A');
    const noConsent = await patient(a.cookie, 'Sem consentimento', false);
    const unrelatedConsent = await patient(a.cookie, 'Consentimento de outra finalidade', false);
    await owner.patientConsent.create({
      data: {
        accountId: a.accountId, patientId: unrelatedConsent, kind: 'IMAGE',
        version: 'test-v1', recordedByUserId: a.userId,
      },
    });
    const template = await call(createTemplate, { cookie: a.cookie, body: {
      name: 'Modelo A', fields: [{ id: 'x', label: 'Campo', type: 'text' }],
    } });
    const templateId = template.json.template.id;

    expect((await call(createAnamnesis, { cookie: a.cookie, params: { id: noConsent }, body: { templateId, answers: {} } })).status).toBe(409);
    expect((await call(listAnthropometry, { method: 'GET', cookie: a.cookie, params: { id: noConsent } })).json.error.code).toBe('consent_required');
    expect((await call(getPatient, { method: 'GET', cookie: a.cookie, params: { id: unrelatedConsent } })).json.alerts).toContain('consent_missing');
    expect((await call(createAnamnesis, { cookie: a.cookie, params: { id: unrelatedConsent }, body: { templateId, answers: {} } })).json.error.code).toBe('consent_required');
    expect((await call(listAnamneses, { method: 'GET', cookie: b.cookie, params: { id: patientA } })).status).toBe(404);
    expect((await call(createAnamnesis, { cookie: b.cookie, params: { id: patientA }, body: { templateId, answers: {} } })).status).toBe(404);
    expect((await call(revokeConsent, { cookie: a.cookie, params: { id: patientA } })).status).toBe(200);
    const afterRevocation = await call(listAnamneses, { method: 'GET', cookie: a.cookie, params: { id: patientA } });
    expect([afterRevocation.status, afterRevocation.json.error.code]).toEqual([409, 'consent_required']);
  });

  it('converte lb/m para kg/cm, calcula IMC, recusa faixas inválidas e guarda somente unidade padrão', async () => {
    const t = await tenant('antropo-api');
    const patientId = await patient(t.cookie, 'Paciente antropometria');
    const saved = await call(createAnthropometry, { cookie: t.cookie, params: { id: patientId }, body: {
      weight: 154.323583, weightUnit: 'lb', height: 1.75, heightUnit: 'm', waistCm: 82,
    } });
    expect(saved.status).toBe(201);
    expect(saved.json.record).toMatchObject({ weightKg: '70', heightCm: '175', bmi: '22.9', waistCm: '82' });
    expect(saved.json.bmiClassification).toBe('NOT_CLASSIFIED');
    const invalid = await call(createAnthropometry, { cookie: t.cookie, params: { id: patientId }, body: {
      weight: 0.5, height: 175,
    } });
    expect([invalid.status, invalid.json.error.code]).toEqual([422, 'validation']);
    const rows = await call(listAnthropometry, { method: 'GET', cookie: t.cookie, params: { id: patientId } });
    expect(rows.json.items).toHaveLength(1);
    const stored = await owner.anthropometryRecord.findFirstOrThrow({ where: { patientId } });
    expect(stored).toMatchObject({
      measuredAt: null, weightKg: null, heightCm: null, bmi: null, waistCm: null,
    });
    expect(stored.clinicalDataCiphertext).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain('"weightKg":70');
    expect(JSON.stringify(stored)).not.toContain('"heightCm":175');
    expect(JSON.stringify(stored)).not.toContain('"waistCm":82');
  });

  it('usa uma chave de dados embrulhada e distinta para cada tenant', async () => {
    const a = await tenant('clinical-key-a');
    const b = await tenant('clinical-key-b');
    for (const [t, prefix] of [[a, 'a'], [b, 'b']] as const) {
      const patientId = await patient(t.cookie, `Paciente ${prefix}`);
      const template = await call(createTemplate, { cookie: t.cookie, body: {
        name: `Modelo ${prefix}`, fields: [{ id: 'campo', label: 'Campo', type: 'text' }],
      } });
      await call(createAnamnesis, { cookie: t.cookie, params: { id: patientId }, body: {
        templateId: template.json.template.id, answers: { campo: `valor ${prefix}` },
      } });
    }
    const keys = await Promise.all([a.accountId, b.accountId].map((accountId) =>
      owner.tenantDataEncryptionKey.findUniqueOrThrow({ where: { accountId } }),
    ));
    expect(keys[0].wrappedKey).not.toBe(keys[1].wrappedKey);
    const { unwrapTenantDataKey } = await import('../../src/clinical/encryption');
    expect(() => unwrapTenantDataKey(a.accountId, keys[1].wrappedKey)).toThrow();
  });

  it('cifra uma resposta legada no primeiro caminho clínico autorizado que a altera', async () => {
    const t = await tenant('clinical-legacy');
    const patientId = await patient(t.cookie, 'Paciente legado');
    const template = await call(createTemplate, { cookie: t.cookie, body: {
      name: 'Modelo legado', fields: [{ id: 'campo', label: 'Campo', type: 'text', required: true }],
    } });
    const version = await owner.anamnesisTemplateVersion.findFirstOrThrow({
      where: { templateId: template.json.template.id },
    });
    const id = randomUUID();
    await owner.anamnesisRecord.create({ data: {
      id, accountId: t.accountId, patientId, templateId: template.json.template.id,
      templateVersionId: version.id, templateVersion: version.version,
      legacyAnswers: { campo: 'resposta legada confidencial' }, status: 'DRAFT',
      createdByUserId: t.userId, updatedByUserId: t.userId,
    } });

    const updated = await call(patchAnamnesis, {
      method: 'PATCH', cookie: t.cookie, params: { id: patientId, recordId: id }, body: { status: 'COMPLETED' },
    });
    expect(updated.status).toBe(200);
    expect(updated.json.record.answers).toEqual({ campo: 'resposta legada confidencial' });
    const stored = await owner.anamnesisRecord.findUniqueOrThrow({ where: { id } });
    expect(stored.legacyAnswers).toBeNull();
    expect(stored.answersCiphertext).not.toContain('resposta legada confidencial');
  });

  it('a secretaria não pode abrir rotas de modelos ou prontuário', async () => {
    const t = await tenant('ana-secretaria');
    const patientId = await patient(t.cookie, 'Paciente restrito');
    await owner.membership.updateMany({ where: { userId: t.userId }, data: { role: 'SECRETARIA' } });
    expect((await call(templates, { method: 'GET', cookie: t.cookie })).status).toBe(403);
    expect((await call(listAnamneses, { method: 'GET', cookie: t.cookie, params: { id: patientId } })).status).toBe(403);
    expect((await call(createAnthropometry, { cookie: t.cookie, params: { id: patientId }, body: { weight: 70, height: 175 } })).status).toBe(403);
  });
});
