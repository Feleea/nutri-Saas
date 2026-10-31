/** Chamada JSON ao backend (cookies HttpOnly vão automaticamente). */
export async function api<T = any>(url: string, body?: unknown, method = 'POST'): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    credentials: 'same-origin',
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

export const errorText = (status: number, data: any): string => {
  if (status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (status === 401) return 'Credenciais inválidas.';
  if (status === 403 && data?.error?.code === 'email_not_verified') return 'Confirme seu e-mail para entrar.';
  if (status === 422 || status === 400) return 'Verifique os dados informados.';
  return 'Não foi possível concluir. Tente novamente.';
};
