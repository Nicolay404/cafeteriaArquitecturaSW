import type { Metadata } from 'next';
import { FormularioRecuperar } from './formulario.tsx';

export const metadata: Metadata = { title: 'Recuperar contraseña · Cafetería' };

export default function Recuperar() {
  return <FormularioRecuperar />;
}
