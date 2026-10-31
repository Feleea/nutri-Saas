import { PrismaClient } from '@prisma/client';

/** Cliente da aplicação: conecta como suasnutri_app (sujeito ao RLS). */
export const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

/**
 * Devolve um cliente "preso" a um tenant. Cada operação roda numa transação
 * que antes define app.account_id (is_local = true), então o RLS do Postgres
 * filtra tudo, mesmo que a aplicação esqueça um `where: { accountId }`.
 */
export function forTenant(accountId: string, userId?: string, client: PrismaClient = prisma) {
  if (!accountId) throw new Error('accountId obrigatório');
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await client.$transaction([
            client.$executeRaw`SELECT set_config('app.account_id', ${accountId}, true), set_config('app.user_id', ${userId ?? ''}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

/** Para fluxos com várias consultas na mesma transação. */
export async function withTenant<T>(
  accountId: string,
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
  client: PrismaClient = prisma,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.account_id', ${accountId}, true)`;
    return fn(tx);
  });
}
