import { PrismaClient } from '@prisma/client';
import { forTenant } from '../db/tenant';
import type { SessionInfo } from '../auth/service';

export function createNoticeService({ db, now = () => new Date() }: { db: PrismaClient; now?: () => Date }) {
  const tenant = (s: SessionInfo) => forTenant(s.accountId, s.userId, db);

  async function list(s: SessionInfo) {
    const rows = await tenant(s).notice.findMany({ where: { readAt: null }, orderBy: { createdAt: 'desc' } });
    return rows.map((n) => ({ id: n.id, kind: n.kind, message: n.message, createdAt: n.createdAt }));
  }

  async function markRead(s: SessionInfo, id: string): Promise<boolean> {
    const r = await tenant(s).notice.updateMany({ where: { id, readAt: null }, data: { readAt: now() } });
    return r.count === 1;
  }

  return { list, markRead };
}
