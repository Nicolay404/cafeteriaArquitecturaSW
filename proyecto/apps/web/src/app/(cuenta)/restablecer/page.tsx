import type { Metadata } from 'next';
import { FormularioRestablecer } from './formulario.tsx';

export const metadata: Metadata = {
  title: 'Elegir contraseña nueva · Cafetería',
  // El enlace lleva un token de un solo uso: que no se envíe a otros sitios ni se indexe.
  referrer: 'no-referrer',
  robots: { index: false },
};

export default async function Restablecer({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return <FormularioRestablecer token={typeof token === 'string' ? token : ''} />;
}
