/** Sem acentos, minúsculo, espaços colapsados: base da busca. */
export const normalizeName = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
