import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { SessionInfo } from '../auth/service';
import { forTenant, withTenant } from '../db/tenant';
import type { PatientDataSource } from '../lgpd/service';
import {
  decryptAttachmentData, encryptAttachmentData, newTenantDataKey, unwrapTenantDataKey, wrapTenantDataKey,
} from '../clinical/encryption';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const CLINICAL = new Set(['TITULAR', 'PROFISSIONAL']);
const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

interface AttachmentRow {
  id: string;
  accountId: string;
  patientId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | bigint;
  encryptedPayload: string;
  createdByUserId: string;
  createdAt: Date;
}

interface AttachmentDb {
  patient: { findFirst(args: any): Promise<unknown> };
  patientAttachment: {
    create(args: any): Promise<AttachmentRow>;
    findMany(args: any): Promise<AttachmentRow[]>;
    findFirst(args: any): Promise<AttachmentRow | null>;
    delete(args: any): Promise<AttachmentRow>;
  };
  tenantDataEncryptionKey: {
    findUnique(args: any): Promise<{ wrappedKey: string } | null>;
    upsert(args: any): Promise<{ wrappedKey: string }>;
  };
  auditLog: { create(args: any): Promise<unknown> };
}

export interface AttachmentMetadata {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export function validateAttachment(fileName: string, mimeType: string, bytes: Uint8Array): string | null {
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return 'attachment_too_large';
  const cleaned = safeFileName(fileName);
  const extension = cleaned.slice(cleaned.lastIndexOf('.')).toLowerCase();
  if (!cleaned || !Object.hasOwn(MIME_BY_EXTENSION, extension) || MIME_BY_EXTENSION[extension] !== mimeType) {
    return 'invalid_attachment';
  }
  const matchesMagic = mimeType === 'application/pdf'
    ? bytes.byteLength >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-'
    : mimeType === 'image/jpeg'
      ? bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.byteLength >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return matchesMagic ? null : 'invalid_attachment';
}

function safeFileName(value: string): string {
  const base = value.replace(/\\/g, '/').split('/').pop()?.normalize('NFC') ?? '';
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
}

function metadata(row: AttachmentRow): AttachmentMetadata {
  return { id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: Number(row.sizeBytes), createdAt: row.createdAt };
}

async function ensureTenantDataKey(tx: AttachmentDb, accountId: string): Promise<Buffer> {
  const generated = newTenantDataKey();
  try {
    const wrappedKey = wrapTenantDataKey(accountId, generated);
    const row = await tx.tenantDataEncryptionKey.upsert({
      where: { accountId },
      create: { accountId, wrappedKey },
      update: {},
    });
    return unwrapTenantDataKey(accountId, row.wrappedKey);
  } finally {
    generated.fill(0);
  }
}

async function existingTenantDataKey(tx: AttachmentDb, accountId: string): Promise<Buffer> {
  const row = await tx.tenantDataEncryptionKey.findUnique({ where: { accountId } });
  if (!row) throw new Error('chave clínica do tenant ausente');
  return unwrapTenantDataKey(accountId, row.wrappedKey);
}

export function createAttachmentService({ db, now = () => new Date() }: { db: PrismaClient; now?: () => Date }) {
  async function authorizedPatient(tx: AttachmentDb, accountId: string, patientId: string) {
    return tx.patient.findFirst({
      where: { id: patientId, consents: { some: { kind: 'DATA_PROCESSING', revokedAt: null } } },
      select: { id: true },
    });
  }

  async function list(session: SessionInfo, patientId: string) {
    if (!CLINICAL.has(session.role)) return { ok: false as const, reason: 'forbidden' as const };
    return withTenant(session.accountId, async (rawTx) => {
      const tx = rawTx as unknown as AttachmentDb;
      if (!await authorizedPatient(tx, session.accountId, patientId)) {
        return { ok: false as const, reason: 'consent_required' as const };
      }
      const rows = await tx.patientAttachment.findMany({
        where: { accountId: session.accountId, patientId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: { accountId: session.accountId, actorUserId: session.userId, action: 'ATTACHMENT_LIST', resource: 'Patient', resourceId: patientId },
      });
      return { ok: true as const, items: rows.map(metadata) };
    }, db);
  }

  async function upload(session: SessionInfo, patientId: string, input: { fileName: string; mimeType: string; bytes: Uint8Array }) {
    if (!CLINICAL.has(session.role)) return { ok: false as const, reason: 'forbidden' as const };
    const reason = validateAttachment(input.fileName, input.mimeType, input.bytes);
    if (reason) return { ok: false as const, reason };
    const fileName = safeFileName(input.fileName);
    return withTenant(session.accountId, async (rawTx) => {
      const tx = rawTx as unknown as AttachmentDb;
      if (!await authorizedPatient(tx, session.accountId, patientId)) {
        return { ok: false as const, reason: 'consent_required' as const };
      }
      const id = randomUUID();
      const key = await ensureTenantDataKey(tx, session.accountId);
      let encryptedPayload: string;
      try {
        encryptedPayload = encryptAttachmentData(session.accountId, id, Buffer.from(input.bytes), key);
      } finally {
        key.fill(0);
      }
      const row = await tx.patientAttachment.create({
        data: {
          id, accountId: session.accountId, patientId, fileName, mimeType: input.mimeType,
          sizeBytes: BigInt(input.bytes.byteLength), encryptedPayload, createdByUserId: session.userId, createdAt: now(),
        },
      });
      await tx.auditLog.create({
        data: { accountId: session.accountId, actorUserId: session.userId, action: 'ATTACHMENT_UPLOAD', resource: 'PatientAttachment', resourceId: row.id },
      });
      return { ok: true as const, attachment: metadata(row) };
    }, db);
  }

  async function download(session: SessionInfo, patientId: string, attachmentId: string) {
    if (!CLINICAL.has(session.role)) return { ok: false as const, reason: 'forbidden' as const };
    return withTenant(session.accountId, async (rawTx) => {
      const tx = rawTx as unknown as AttachmentDb;
      if (!await authorizedPatient(tx, session.accountId, patientId)) {
        return { ok: false as const, reason: 'consent_required' as const };
      }
      const row = await tx.patientAttachment.findFirst({
        where: { id: attachmentId, accountId: session.accountId, patientId },
      });
      if (!row) return { ok: false as const, reason: 'not_found' as const };
      const key = await existingTenantDataKey(tx, session.accountId);
      let bytes: Buffer;
      try {
        bytes = decryptAttachmentData(session.accountId, row.id, row.encryptedPayload, key);
      } finally {
        key.fill(0);
      }
      await tx.auditLog.create({
        data: { accountId: session.accountId, actorUserId: session.userId, action: 'ATTACHMENT_DOWNLOAD', resource: 'PatientAttachment', resourceId: row.id },
      });
      return { ok: true as const, attachment: metadata(row), bytes };
    }, db);
  }

  async function remove(session: SessionInfo, patientId: string, attachmentId: string) {
    if (!CLINICAL.has(session.role)) return { ok: false as const, reason: 'forbidden' as const };
    return withTenant(session.accountId, async (rawTx) => {
      const tx = rawTx as unknown as AttachmentDb;
      if (!await authorizedPatient(tx, session.accountId, patientId)) {
        return { ok: false as const, reason: 'consent_required' as const };
      }
      const row = await tx.patientAttachment.findFirst({
        where: { id: attachmentId, accountId: session.accountId, patientId },
      });
      if (!row) return { ok: false as const, reason: 'not_found' as const };
      await tx.patientAttachment.delete({ where: { id: row.id } });
      await tx.auditLog.create({
        data: { accountId: session.accountId, actorUserId: session.userId, action: 'ATTACHMENT_DELETE', resource: 'PatientAttachment', resourceId: row.id },
      });
      return { ok: true as const };
    }, db);
  }

  return { list, upload, download, remove };
}

export const attachmentDataSource: PatientDataSource = {
  name: 'anexos',
  async collect(tenant, patientId) {
    const tx = tenant as unknown as AttachmentDb;
    const rows = await tx.patientAttachment.findMany({
      where: { patientId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
    });
    return rows.map(metadata);
  },
};
