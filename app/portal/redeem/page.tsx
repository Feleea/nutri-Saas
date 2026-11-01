import { Suspense } from 'react';
import PortalRedeem from './PortalRedeem';

export const dynamic = 'force-dynamic';

export default function RedeemPage() {
  return <Suspense fallback={<main><p>Validando convite…</p></main>}><PortalRedeem /></Suspense>;
}
