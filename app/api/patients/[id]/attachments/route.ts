import { defineRoute, fail, failFrom } from '@/src/server/http';
import { attachmentService } from '@/src/attachments/api';
import { z } from 'zod';
import { MAX_ATTACHMENT_BYTES } from '@/src/attachments/service';

type Params = { id: string };

export const GET = defineRoute<undefined, Params>({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ session, params }) => {
    const result = await attachmentService().list(session!, params.id);
    return result.ok ? { items: result.items } : failFrom(result.reason);
  },
});

const uploadBody = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  base64: z.string().min(1).max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4),
});

export const POST = defineRoute<z.infer<typeof uploadBody>, Params>({
  auth: 'session',
  action: 'patient.write',
  body: uploadBody,
  handler: async ({ body, session, params }) => {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64)) {
      return fail(400, 'invalid_attachment');
    }
    const bytes = Buffer.from(body.base64, 'base64');
    if (bytes.toString('base64') !== body.base64) return fail(400, 'invalid_attachment');
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return fail(413, 'attachment_too_large');
    const result = await attachmentService().upload(session!, params.id, {
      fileName: body.fileName,
      mimeType: body.mimeType,
      bytes,
    });
    if (!result.ok) {
      return result.reason === 'attachment_too_large'
        ? fail(413, result.reason)
        : failFrom(result.reason);
    }
    return { attachment: result.attachment };
  },
});
