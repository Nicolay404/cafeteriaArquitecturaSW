import type { Metadata } from 'next';
import { FormularioAcceso } from './formulario.tsx';

export const metadata: Metadata = { title: 'Iniciar sesión · Cafetería' };

export default function Acceso() {
  return <FormularioAcceso />;
}
