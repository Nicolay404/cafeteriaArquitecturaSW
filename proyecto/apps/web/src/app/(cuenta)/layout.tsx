import type { ReactNode } from 'react';
import '@cafeteria/ui/ui.css';

// Pantallas de cuenta (Spec #2). El único <main> de la página es este: el enlace de salto del
// layout raíz apunta a #contenido. Estilos y textos: propuesta pendiente de aprobación del equipo
// (specs/002-identidad-clientes/decisions/visual-direction.md).
export default function CuentaLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main id="contenido" tabIndex={-1} className="cuenta-main">
      {children}
    </main>
  );
}
