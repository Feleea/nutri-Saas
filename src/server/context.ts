import { prisma } from '../db/tenant';
import { adminPrisma } from '../db/admin';
import { createAuthService } from '../auth/service';
import { createAdminAuthService } from '../auth/admin';
import { createTeamService } from '../team/service';
import { createBillingService } from '../billing/service';
import { HmacGateway } from '../billing/gateway';
import { createFoodService } from '../foods/service';
import { createLgpdService } from '../lgpd/service';
import { createPatientService, consentDataSource } from '../patients/service';
import { createNoticeService } from '../notices/service';
import { createAgendaService, appointmentDataSource } from '../agenda/service';
import { createClinicalService, anamnesisDataSource } from '../clinical/service';
import { createMealPlanService, mealPlanDataSource } from '../meal-plans/service';
import { createAttachmentService, attachmentDataSource } from '../attachments/service';
import { createFinanceService } from '../finance/service';
import { createPackagesService } from '../packages/service';
import { createReminderJob } from '../agenda/reminders';
import { createAdminPanel } from '../admin/panel';
import { RateLimiter } from './ratelimit';
import { createMailer } from './mailer';

function build() {
  const secret = process.env.GATEWAY_WEBHOOK_SECRET;
  if (!secret) throw new Error('GATEWAY_WEBHOOK_SECRET ausente');
  const mailer = createMailer();
  const adminAuth = createAdminAuthService({ db: adminPrisma });
  const patients = createPatientService({ db: prisma, mailer });
  const clinical = createClinicalService({ db: prisma });
  const attachments = createAttachmentService({ db: prisma });
  return {
    mailer,
    limiter: new RateLimiter(),
    auth: createAuthService({ db: prisma, mailer }),
    team: createTeamService({ db: prisma, mailer }),
    foods: createFoodService({ db: prisma }),
    patients,
    clinical,
    attachments,
    mealPlans: createMealPlanService({ db: prisma }),
    packages: createPackagesService({ db: prisma }),
    finance: createFinanceService({ db: prisma }),
    notices: createNoticeService({ db: prisma }),
    agenda: createAgendaService({ db: prisma }),
    reminders: createReminderJob({ db: prisma, mailer }),
    // seções clínicas das próximas fases entram em `sources`; limpeza de cópias externas em `hooks`
    lgpd: createLgpdService({
      db: prisma,
      sources: [consentDataSource, appointmentDataSource, anamnesisDataSource, mealPlanDataSource, attachmentDataSource],
      hooks: [{ name: 'avisos-de-limite', purge: (_patientId, accountId) => patients.reconcileLimitNotices(accountId) }],
    }),
    // serviços de plataforma: usam o papel admin do banco e só são chamados depois da autorização na rota
    billing: createBillingService({ db: adminPrisma, mailer, gateway: new HmacGateway(secret) }),
    adminAuth,
    panel: createAdminPanel({ db: adminPrisma, adminAuth }),
  };
}

export type AppCtx = ReturnType<typeof build>;
const g = globalThis as unknown as { __snCtx?: AppCtx };

/** Singleton por processo (sobrevive ao hot reload em desenvolvimento). */
export const ctx = (): AppCtx => (g.__snCtx ??= build());
