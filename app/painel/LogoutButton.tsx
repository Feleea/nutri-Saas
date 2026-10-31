'use client';
import { useRouter } from 'next/navigation';
import { api } from '../_lib/api';

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button className="secondary" onClick={async () => { await api('/api/auth/logout'); router.push('/login'); }}>
      Sair
    </button>
  );
}
