import type { Metadata } from 'next';
import { Confirmar } from './confirmar.tsx';

export const metadata: Metadata = {
  title: 'Confirmar correo · Cafetería',
  referrer: 'no-referrer',
  robots: { index: false },
};

export default async function ConfirmarPagina({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ token?: string | string[] }>;
}>) {
  const { token } = await searchParams;
  return <Confirmar token={typeof token === 'string' ? token : ''} />;
}
