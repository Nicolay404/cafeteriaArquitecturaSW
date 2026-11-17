import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './bootstrap.css';

export const metadata: Metadata = {
  title: 'Cafetería',
  description: 'Página inicial de la cafetería.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <a className="skip-link" href="#contenido">
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
