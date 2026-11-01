import { defineRoute, fail, failFrom } from '@/src/server/http';
import { attachmentService } from '@/src/attachments/api';

type Params = { id: string; attachmentId: string };
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export const GET = defineRoute<undefined, Params>({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ session, params }) => {
    const result = await attachmentService().download(session!, params.id, params.attachmentId);
    if (!result.ok) return failFrom(result.reason);
    if (!ALLOWED_MIME.has(result.attachment.mimeType)) return fail(500, 'internal_error');

    const safeName = result.attachment.fileName.replace(/[\r\n"\\]/g, '_');
    const fallbackName = safeName.replace(/[^\x20-\x7e]/g, '_');
    const encodedName = encodeURIComponent(safeName).replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    const disposition = `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`;
    return new Response(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        'content-type': result.attachment.mimeType,
        'content-length': String(result.bytes.byteLength),
        'content-disposition': disposition,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      },
    });
  },
});
