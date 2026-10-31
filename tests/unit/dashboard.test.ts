import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { HmacGateway } from '../../src/billing/gateway';
import { createBillingService } from '../../src/billing/service';
import { MemoryMailer } from '../../src/auth/mailer';
import { createPatientService } from '../../src/patients/service';

const db = {} as PrismaClient;
const session = { userId: 'user_1', accountId: 'account_1', role: 'SECRETARIA' };

describe('dashboard role boundaries', () => {
  it('does not expose subscription status to non-titular roles', async () => {
    const billing = createBillingService({
      db,
      mailer: new MemoryMailer(),
      gateway: new HmacGateway('test-secret'),
    });

    await expect(billing.loadDashboardState(session)).resolves.toEqual({ ok: false, reason: 'forbidden' });
  });

  it('does not expose patient metrics to non-titular roles', async () => {
    const patients = createPatientService({ db, mailer: new MemoryMailer() });

    await expect(patients.dashboardCounts(session, 90)).resolves.toEqual({ ok: false, reason: 'forbidden' });
  });
});
