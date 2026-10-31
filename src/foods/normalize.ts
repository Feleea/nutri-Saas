/** Remove acentos e pontuação, normaliza caixa e espaços para formar a chave de busca. */
export const normalizeName = (s: string) =>
  s.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
