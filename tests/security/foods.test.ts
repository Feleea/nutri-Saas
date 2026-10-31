import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { seedTenants, TENANT_A, TENANT_B } from '../../prisma/seed-data';
import { importFoodTable, verifyReferenceSample } from '../../src/foods/import';
import { createFoodService } from '../../src/foods/service';
import { forTenant } from '../../src/db/tenant';
import { normalizeName } from '../../src/foods/normalize';
import type { SessionInfo } from '../../src/auth/service';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const foods = createFoodService({ db });
const csv = readFileSync(new URL('../fixtures/foods-sample.csv', import.meta.url), 'utf8');
const sessionA: SessionInfo = { userId: `${TENANT_A}_user`, accountId: TENANT_A, role: 'TITULAR' };
const sessionB: SessionInfo = { userId: `${TENANT_B}_user`, accountId: TENANT_B, role: 'TITULAR' };
const src = { code: 'SINT', name: 'Tabela sintética de teste', version: 'v1', license: 'Dados sintéticos: uso livre em testes', csv, expectedCount: 13 };

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await Promise.all([owner.$disconnect(), db.$disconnect()]); });

describe('US-ALI-01 · importar tabelas de composição [api][unit]', () => {
  it('importa, confere a contagem com a fonte e lista as linhas rejeitadas', async () => {
    const r = await importFoodTable(owner, src);
    expect(r).toMatchObject({ sourceRows: 13, imported: 9, updated: 0, reconciled: true, matchesExpected: true });
    expect(r.rejected).toEqual([
      { line: 10, code: 'S009', reason: 'valor_invalido' },
      { line: 11, code: 'S010', reason: 'valor_negativo' },
      { line: 12, code: null, reason: 'codigo_ausente' },
      { line: 13, code: 'S001', reason: 'codigo_duplicado' },
    ]);
    expect(r.warnings.map((w) => w.code)).toEqual(['S011']); // importada, mas sinalizada
    const table = await owner.foodTable.findUniqueOrThrow({ where: { code: 'SINT' } });
    expect(table).toMatchObject({ version: 'v1', name: 'Tabela sintética de teste' });
    expect(await owner.food.count({ where: { tableId: table.id } })).toBe(9);
  });

  it('reexecutar o mesmo arquivo não duplica (idempotente)', async () => {
    const r = await importFoodTable(owner, src);
    expect(r).toMatchObject({ imported: 0, updated: 9, reconciled: true });
    const table = await owner.foodTable.findUniqueOrThrow({ where: { code: 'SINT' } });
    expect(await owner.food.count({ where: { tableId: table.id } })).toBe(9);
  });

  it('valores ausentes ficam nulos (nunca zero) e traços viram zero', async () => {
    const vazio = await owner.food.findFirstOrThrow({ where: { externalCode: 'S008' } });
    expect([vazio.energyKcal, vazio.proteinG, vazio.carbG, vazio.fatG, vazio.fiberG]).toEqual([null, null, null, null, null]);
    const feijao = await owner.food.findFirstOrThrow({ where: { externalCode: 'S002' } });
    expect(feijao.micros).toMatchObject({ calcio_mg: 27, ferro_mg: 1.3, vitamina_c_mg: 0 });
  });

  it('amostra de referência coincide com a fonte, dentro da tolerância', async () => {
    const ok = await verifyReferenceSample(owner, 'SINT', [
      { code: 'S003', energyKcal: 125, proteinG: 0.6, carbG: 30.1 },
      { code: 'S007', fatG: 100, energyKcal: 884 },
    ]);
    expect(ok).toEqual([]);
    const bad = await verifyReferenceSample(owner, 'SINT', [{ code: 'S003', energyKcal: 130 }, { code: 'XXX' }]);
    expect(bad.map((m) => m.field)).toEqual(['energyKcal', 'missing']);
  });

  it('sem condições de uso confirmadas, a importação é recusada', async () => {
    await expect(importFoodTable(owner, { ...src, code: 'SEM', license: ' ' })).rejects.toThrow('license_required');
    expect(await owner.foodTable.count({ where: { code: 'SEM' } })).toBe(0);
  });

  it('a fonte e a versão acompanham o alimento exibido', async () => {
    const [r] = await foods.search(sessionA, 'arroz integral');
    expect(r.source).toEqual({ code: 'SINT', name: 'Tabela sintética de teste', version: 'v1' });
  });
});

describe('US-ALI-02 · buscar alimentos [api][e2e]', () => {
  it('ignora acentos e maiúsculas', async () => {
    const r = await foods.search(sessionA, 'FEIJAO');
    expect(r.map((f) => f.name)).toEqual(['Feijão, carioca, cozido (sintético)']);
  });

  it('sinônimos regionais retornam ambos os alimentos', async () => {
    const names = (await foods.search(sessionA, 'mandioca')).map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['Mandioca, cozida (sintético)', 'Aipim, frito (sintético)']));
  });

  it('a tabela padrão da conta aparece primeiro', async () => {
    const outra = await owner.foodTable.create({ data: { code: 'OUTRA', name: 'Outra tabela', version: '1', license: 'teste' } });
    await owner.food.create({ data: { tableId: outra.id, externalCode: 'O1', name: 'Mandioca, crua (outra)', normalizedName: normalizeName('Mandioca, crua (outra)') } });

    const before = await foods.search(sessionA, 'mandioca');
    expect(before[0].source?.code).toBe('SINT'); // empate de relevância: nome mais curto
    expect(await foods.setDefaultTable(sessionA, 'OUTRA')).toEqual({ ok: true });
    const after = await foods.search(sessionA, 'mandioca');
    expect(after[0].source?.code).toBe('OUTRA');
    expect(await foods.setDefaultTable({ ...sessionA, role: 'SECRETARIA' }, 'SINT')).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('responde em até 300 ms com o catálogo completo (milhares de alimentos)', async () => {
    const table = await owner.foodTable.findUniqueOrThrow({ where: { code: 'OUTRA' } });
    await owner.food.createMany({
      data: Array.from({ length: 6000 }, (_, i) => ({
        tableId: table.id, externalCode: `P${i}`, name: `Alimento sintético ${i}`, normalizedName: `alimento sintetico ${i}`,
      })),
    });
    await foods.search(sessionA, 'sintetico 42'); // aquecimento
    const t0 = performance.now();
    const r = await foods.search(sessionA, 'sintetico 4242');
    const ms = performance.now() - t0;
    expect(r.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(300);
  });
});

describe('US-ALI-03 · alimentos próprios [seg][unit]', () => {
  const caldo = { name: 'Caldo da casa', per: 'portion' as const, portionGrams: 200, values: { energyKcal: 90, proteinG: 6, carbG: 8, fatG: 3 } };

  it('converte valores por porção para 100 g e deixa o alimento só no meu tenant', async () => {
    const r = await foods.createCustomFood(sessionA, caldo);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.food.accountId).toBe(TENANT_A);
    expect(Number(r.food.energyKcal)).toBe(45);
    expect((await foods.search(sessionA, 'caldo da casa')).map((f) => f.own)).toEqual([true]);
    expect(await foods.search(sessionB, 'caldo da casa')).toEqual([]);
    expect(await forTenant(TENANT_B, undefined, db).food.findUnique({ where: { id: r.food.id } })).toBeNull();
  });

  it('dados inconsistentes alertam antes de salvar e só gravam com confirmação', async () => {
    const dados = { name: 'Suspeito', per: '100g' as const, values: { energyKcal: 100, proteinG: 60, carbG: 60, fatG: 10 } };
    const r = await foods.createCustomFood(sessionA, dados);
    expect(r).toMatchObject({ ok: false, needsConfirm: true });
    expect(await owner.food.count({ where: { name: 'Suspeito' } })).toBe(0);
    expect((await foods.createCustomFood(sessionA, { ...dados, confirm: true })).ok).toBe(true);
  });

  it('valor negativo é recusado mesmo com confirmação', async () => {
    const r = await foods.createCustomFood(sessionA, { name: 'X', per: '100g', values: { proteinG: -2 }, confirm: true });
    expect(r).toMatchObject({ ok: false, errors: ['proteinG_invalid'] });
  });

  it('alimentos das tabelas oficiais são somente leitura para o tenant', async () => {
    const t = forTenant(TENANT_A, undefined, db);
    expect((await t.food.updateMany({ where: { externalCode: 'S003' }, data: { name: 'adulterado' } })).count).toBe(0);
    expect((await t.food.deleteMany({ where: { externalCode: 'S003' } })).count).toBe(0);
    await expect(t.food.create({ data: { accountId: null, name: 'global falso', normalizedName: 'global falso' } })).rejects.toThrow();
  });
});

describe('US-ALI-04 · medidas caseiras [unit][e2e][seg]', () => {
  it('oferece gramas + medidas cadastradas; alimento sem medida oferece só gramas', async () => {
    const s003 = await owner.food.findFirstOrThrow({ where: { externalCode: 'S003' } });
    await owner.householdMeasure.create({ data: { foodId: s003.id, label: 'fatia', grams: 60 } });
    expect(await foods.getMeasures(sessionA, s003.id)).toEqual([{ label: 'g', grams: 1 }, { label: 'fatia', grams: 60 }]);
    const s005 = await owner.food.findFirstOrThrow({ where: { externalCode: 'S005' } });
    expect(await foods.getMeasures(sessionA, s005.id)).toEqual([{ label: 'g', grams: 1 }]);
  });

  it('medidas de alimento próprio são privadas; as de alimentos oficiais não aceitam escrita', async () => {
    const own = await owner.food.findFirstOrThrow({ where: { name: 'Caldo da casa' } });
    expect(await foods.addMeasure(sessionA, own.id, 'concha', 120)).toEqual({ ok: true });
    expect(await foods.getMeasures(sessionA, own.id)).toHaveLength(2);
    expect(await foods.getMeasures(sessionB, own.id)).toHaveLength(1); // B não vê a medida de A

    const oficial = await owner.food.findFirstOrThrow({ where: { externalCode: 'S003' } });
    expect(await foods.addMeasure(sessionA, oficial.id, 'pedaço', 50)).toEqual({ ok: false, reason: 'not_found' });
    expect(await foods.addMeasure(sessionA, own.id, '', 10)).toEqual({ ok: false, reason: 'invalid' });
  });
});
