/** Janela deslizante em memória. Em produção com várias instâncias, trocar por Redis (mesma interface). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}

  hit(key: string, max: number, windowSec: number): { allowed: boolean; retryAfterSec: number } {
    const t = this.now();
    const from = t - windowSec * 1000;
    const recent = (this.hits.get(key) ?? []).filter((x) => x > from);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowSec * 1000 - t) / 1000)) };
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 50_000) this.sweep(from);
    return { allowed: true, retryAfterSec: 0 };
  }

  private sweep(from: number) {
    for (const [k, v] of this.hits) if (!v.some((x) => x > from)) this.hits.delete(k);
  }
}
