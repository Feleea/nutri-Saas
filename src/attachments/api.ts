import { ctx } from '../server/context';
import type { createAttachmentService } from './service';

export function attachmentService(): ReturnType<typeof createAttachmentService> {
  return (ctx() as unknown as { attachments: ReturnType<typeof createAttachmentService> }).attachments;
}
