import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from './seed-data';

const db = new PrismaClient(); // dono do schema (DATABASE_URL_OWNER)
seedTenants(db)
  .then(() => console.log('Seed sintético aplicado (tenants A e B).'))
  .finally(() => db.$disconnect());
