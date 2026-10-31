import { normalizeName } from './normalize';

// Nomes regionais do mesmo alimento. Amplie conforme o feedback dos nutricionistas.
const GROUPS = [
  ['mandioca', 'aipim', 'macaxeira'],
  ['tangerina', 'bergamota', 'mexerica'],
  ['abobora', 'jerimum'],
  ['batata doce', 'batata-doce'],
  ['vagem', 'feijao verde'],
  ['bolacha', 'biscoito'],
];

/** O termo digitado e suas variações regionais (sem repetir). */
export function expandTerm(term: string): string[] {
  const n = normalizeName(term);
  const out = new Set([n]);
  for (const g of GROUPS) {
    const hit = g.find((w) => n.includes(w));
    if (hit) for (const other of g) out.add(n.replace(hit, other));
  }
  return [...out];
}
