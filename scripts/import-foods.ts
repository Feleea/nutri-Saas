import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { importFoodTable } from '../src/foods/import';

// Uso: npm run foods:import -- --code TACO --name "Tabela Brasileira de Composição de Alimentos"
//        --version 4a-ed --license "<condições de uso confirmadas>" --file ./dados/taco.csv --expected 597
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const required = ['code', 'name', 'version', 'license', 'file'];
const missing = required.filter((r) => !arg(r));
if (missing.length) {
  console.error(`Faltam argumentos: ${missing.map((m) => '--' + m).join(', ')}`);
  process.exit(1);
}

const db = new PrismaClient(); // dono do schema (DATABASE_URL_OWNER): grava alimentos globais
importFoodTable(db, {
  code: arg('code')!, name: arg('name')!, version: arg('version')!, license: arg('license')!,
  sourceUrl: arg('source-url'), csv: readFileSync(arg('file')!, 'utf8'),
  expectedCount: arg('expected') ? Number(arg('expected')) : undefined,
})
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    if (!r.reconciled || r.matchesExpected === false) process.exitCode = 2;
  })
  .finally(() => db.$disconnect());
