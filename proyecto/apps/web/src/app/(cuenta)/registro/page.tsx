import type { Metadata } from 'next';
import { FormularioRegistro } from './formulario.tsx';

export const metadata: Metadata = { title: 'Crear cuenta · Cafetería' };

export default function Registro() {
  return <FormularioRegistro />;
}
