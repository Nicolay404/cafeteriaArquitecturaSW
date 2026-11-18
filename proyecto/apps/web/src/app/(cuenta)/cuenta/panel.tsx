'use client';

import { useEffect, useState } from 'react';
import { AccountShell, Button, StatusMessage } from '@cafeteria/ui';
import { llamar } from '../cliente-api.ts';

interface Sesion {
  rol: string;
  nombre: string | null;
  csrf: string;
}

// Punto de llegada tras iniciar sesión. Perfil, historial y privacidad llegan con US3 y US4; aquí
// solo se ve quién es la sesión y se puede cerrar.
export function Panel() {
  const [state, setState] = useState<'loading' | 'out' | 'error' | Sesion>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await llamar<Sesion>('sesion', { method: 'GET' });
      if (result.ok) return setState(result.data);
      setState(result.status === 401 ? 'out' : 'error');
    })();
  }, []);

  async function logout(session: Sesion) {
    setBusy(true);
    await llamar('cierre', { csrf: session.csrf });
    window.location.assign('/acceso');
  }

  if (state === 'loading')
    return (
      <AccountShell title="Mi cuenta">
        <p role="status">Cargando tu cuenta…</p>
      </AccountShell>
    );

  if (state === 'out')
    return (
      <AccountShell title="Tu sesión terminó">
        <StatusMessage kind="error">Inicia sesión para ver tu cuenta.</StatusMessage>
        <p className="cuenta-alternativa">
          <a href="/acceso">Iniciar sesión</a>
        </p>
      </AccountShell>
    );

  if (state === 'error')
    return (
      <AccountShell title="Mi cuenta">
        <StatusMessage kind="error">
          No pudimos cargar tu cuenta. Recarga la página en un momento.
        </StatusMessage>
      </AccountShell>
    );

  return (
    <AccountShell
      title={state.nombre ? `Hola, ${state.nombre}` : 'Mi cuenta'}
      intro="Iniciaste sesión correctamente. Tu perfil, tu historial de pedidos y tus datos personales estarán disponibles aquí pronto."
    >
      <Button variant="secondary" busy={busy} onClick={() => void logout(state)}>
        Cerrar sesión
      </Button>
    </AccountShell>
  );
}
