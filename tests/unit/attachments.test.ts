import { describe, expect, it } from 'vitest';
import { decryptAttachmentData, encryptAttachmentData, newTenantDataKey } from '../../src/clinical/encryption';
import {
  attachmentDataSource, createAttachmentService, MAX_ATTACHMENT_BYTES, validateAttachment,
} from '../../src/attachments/service';

describe('patient attachment security primitives', () => {
  const pdf = Buffer.from('%PDF-1.7\nsynthetic test document');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

  it('encrypts arbitrary binary data and binds it to its tenant and attachment ID', () => {
    const key = newTenantDataKey();
    const encrypted = encryptAttachmentData('tenant-a', 'attachment-a', png, key);

    expect(encrypted).not.toContain(png.toString('base64'));
    expect(decryptAttachmentData('tenant-a', 'attachment-a', encrypted, key)).toEqual(png);
    expect(() => decryptAttachmentData('tenant-b', 'attachment-a', encrypted, key)).toThrow();
    expect(() => decryptAttachmentData('tenant-a', 'attachment-b', encrypted, key)).toThrow();
  });

  it('allows only matching extensions, MIME types, and file signatures', () => {
    expect(validateAttachment('scan.pdf', 'application/pdf', pdf)).toBeNull();
    expect(validateAttachment('scan.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBeNull();
    expect(validateAttachment('scan.png', 'image/png', png)).toBeNull();
    expect(validateAttachment('scan.pdf', 'image/png', pdf)).toBe('invalid_attachment');
    expect(validateAttachment('scan.pdf', 'application/pdf', Buffer.from('not a PDF'))).toBe('invalid_attachment');
    expect(validateAttachment('scan.exe', 'application/pdf', pdf)).toBe('invalid_attachment');
  });

  it('rejects attachments larger than 10 MB', () => {
    expect(validateAttachment('scan.pdf', 'application/pdf', new Uint8Array(MAX_ATTACHMENT_BYTES + 1)))
      .toBe('attachment_too_large');
  });

  it('enforces clinical role and consent for attachment operations and exports only metadata', async () => {
    let consent = true;
    const rows: any[] = [];
    let wrappedKey: string | null = null;
    const tx = {
      $executeRaw: async () => 0,
      patient: { findFirst: async () => consent ? { id: 'patient-a' } : null },
      patientAttachment: {
        create: async ({ data }: any) => { rows.push(data); return data; },
        findMany: async () => rows.map(({ id, fileName, mimeType, sizeBytes, createdAt }) =>
          ({ id, fileName, mimeType, sizeBytes, createdAt })),
        findFirst: async ({ where }: any) => rows.find((row) =>
          row.id === where.id && row.patientId === where.patientId && row.accountId === where.accountId) ?? null,
        delete: async ({ where }: any) => {
          const index = rows.findIndex((row) => row.id === where.id);
          return rows.splice(index, 1)[0];
        },
      },
      tenantDataEncryptionKey: {
        findUnique: async () => wrappedKey ? { wrappedKey } : null,
        upsert: async ({ create }: any) => {
          wrappedKey ??= create.wrappedKey;
          return { wrappedKey };
        },
      },
      auditLog: { create: async () => ({}) },
    };
    const db = { $transaction: async (callback: (arg: unknown) => Promise<unknown>) => callback(tx) };
    const service = createAttachmentService({ db: db as never });
    const clinical = { accountId: 'tenant-a', userId: 'user-a', role: 'PROFISSIONAL' } as any;
    const secretary = { ...clinical, role: 'SECRETARIA' };

    expect(await service.list(secretary, 'patient-a')).toMatchObject({ ok: false, reason: 'forbidden' });
    consent = false;
    expect(await service.list(clinical, 'patient-a')).toMatchObject({ ok: false, reason: 'consent_required' });
    consent = true;
    const uploaded = await service.upload(clinical, 'patient-a', {
      fileName: 'scan.pdf', mimeType: 'application/pdf', bytes: pdf,
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;
    expect(rows[0].encryptedPayload).not.toContain(pdf.toString('base64'));

    const listed = await service.list(clinical, 'patient-a');
    expect(listed).toMatchObject({ ok: true, items: [{ id: uploaded.attachment.id, fileName: 'scan.pdf' }] });
    expect(JSON.stringify(listed)).not.toContain('encryptedPayload');
    expect(await service.download(secretary, 'patient-a', uploaded.attachment.id)).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(await service.download(clinical, 'patient-a', uploaded.attachment.id)).toMatchObject({
      ok: true, bytes: pdf, attachment: { mimeType: 'application/pdf' },
    });
    expect(await attachmentDataSource.collect({ patientAttachment: tx.patientAttachment } as any, 'patient-a'))
      .toMatchObject([{ fileName: 'scan.pdf', sizeBytes: pdf.byteLength }]);
    expect(await service.remove(clinical, 'patient-a', uploaded.attachment.id)).toEqual({ ok: true });
    expect(await service.download(clinical, 'patient-a', uploaded.attachment.id)).toMatchObject({ ok: false, reason: 'not_found' });
  });
});
