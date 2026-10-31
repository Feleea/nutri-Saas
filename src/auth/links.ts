/** Base dos links enviados por e-mail (APP_BASE_URL). */
export const appUrl = (path: string) => `${(process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')}${path}`;
