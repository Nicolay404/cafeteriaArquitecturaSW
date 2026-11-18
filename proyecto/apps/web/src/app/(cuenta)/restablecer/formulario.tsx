'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { restablecerRequest } from '@cafeteria/contracts/cuenta';
import { AccountShell, Button, ErrorSummary, PasswordField, StatusMessage } from '@cafeteria/ui';
import { camposPorNombre, llamar, validar } from '../cliente-api.ts';

export function FormularioRestablecer({ token }: { token: string }) {
  const [contrasena, setContrasena] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setGeneral(null);
    const checked = validar(restablecerRequest, { token, contrasena });
    if (!checked.ok) {
      // Un token ausente o mal formado no es un campo del formulario: se explica aparte.
      if (checked.campos['token']) setExpired(true);
      return setErrors(
        checked.campos['contrasena'] ? { contrasena: checked.campos['contrasena'] } : {},
      );
    }
    setErrors({});
    setBusy(true);
    const result = await llamar('restablecer', { body: checked.data });
    setBusy(false);
    if (result.ok) return setDone(true);
    if (result.status === 410) return setExpired(true);
    if (result.error.campos?.length) return setErrors(camposPorNombre(result.error.campos));
    setGeneral(result.error.mensaje);
  }

  if (done)
    return (
      <AccountShell title="Contraseña cambiada">
        <StatusMessage kind="ok">
          Listo: ya puedes entrar con tu contraseña nueva. Cerramos tus otras sesiones por
          seguridad.
        </StatusMessage>
        <p className="cuenta-alternativa">
          <a href="/acceso">Iniciar sesión</a>
        </p>
      </AccountShell>
    );

  if (expired || !token)
    return (
      <AccountShell title="Este enlace no sirve">
        <StatusMessage kind="error">
          El enlace ya se usó, caducó o no es válido. Pide uno nuevo para elegir tu contraseña.
        </StatusMessage>
        <p className="cuenta-alternativa">
          <a href="/recuperar">Pedir un enlace nuevo</a>
        </p>
      </AccountShell>
    );

  return (
    <AccountShell
      title="Elegir contraseña nueva"
      intro="Usa al menos 12 caracteres. Una frase larga que solo tú conozcas funciona mejor que símbolos."
    >
      {general ? <StatusMessage kind="error">{general}</StatusMessage> : null}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <ErrorSummary
          errors={
            errors['contrasena'] ? [{ fieldId: 'contrasena', message: errors['contrasena'] }] : []
          }
        />
        <PasswordField
          id="contrasena"
          name="contrasena"
          label="Contraseña nueva"
          autoComplete="new-password"
          required
          value={contrasena}
          onChange={(event) => setContrasena(event.target.value)}
          error={errors['contrasena']}
        />
        <Button type="submit" busy={busy} block>
          Guardar contraseña
        </Button>
      </form>
    </AccountShell>
  );
}
