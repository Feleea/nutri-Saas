import { PrismaClient } from '@prisma/client';

/**
 * Cliente do painel do dono: conecta como suasnutri_admin.
 * O tipo gerado expõe Patient & cia, mas o BANCO nega o acesso
 * (sem GRANT). A privacidade não depende de "regras no código".
 */
export const adminPrisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });

/** Recalcula os contadores diários (só contagens). Rodar em job agendado. */
export async function refreshUsageCounters() {
  await adminPrisma.$executeRaw`SELECT refresh_usage_counters()`;
}
