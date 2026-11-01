import { defineRoute, failFrom } from '@/src/server/http';
import { attachmentService } from '@/src/attachments/api';

type Params = { id: string; attachmentId: string };

export const DELETE = defineRoute<undefined, Params>({
  auth: 'session',
  action: 'patient.write',
  handler: async ({ session, params }) => {
    const result = await attachmentService().remove(session!, params.id, params.attachmentId);
    return result.ok ? { ok: true } : failFrom(result.reason);
  },
});
