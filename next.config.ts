import type { NextConfig } from 'next';

const prod = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${prod ? '' : " 'unsafe-eval'"}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  },
  // TLS obrigatório: o navegador passa a recusar HTTP para este domínio
  ...(prod ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : []),
];

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
