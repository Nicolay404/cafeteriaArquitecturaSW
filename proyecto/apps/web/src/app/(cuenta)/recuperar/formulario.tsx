'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { correoRequest } from '@cafeteria/contracts/cuenta';
import { AccountShell, Button, ErrorSummary, Field, StatusMessage } from '@cafeteria/ui';
import { llamar, validar } from '../cliente-api.ts';

export function FormularioRecuperar() {
  const [correo, setCorreo] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setAttempt((current) => current + 1);
    setGeneral(null);
    const checked = validar(correoRequest, { correo });
    if (!checked.ok) return setError(checked.campos['correo']);
    setError(undefined);
    setBusy(true);
    const result = await llamar('recuperar', { body: checked.data });
    setBusy(false);
    if (result.ok) return setSent(true);
    setGeneral(result.error.mensaje);
  }

  if (sent)
    return (
      <AccountShell title="Revisa tu correo">
        <StatusMessage kind="ok">
          Si hay una cuenta con ese correo, te enviamos un enlace para elegir una contraseña nueva.
          Caduca en 30 minutos y solo funciona una vez.
        </StatusMessage>
        <p className="cuenta-alternativa">
          <a href="/acceso">Volver a iniciar sesión</a>
        </p>
      </AccountShell>
    );

  return (
    <AccountShell
      title="Recuperar contraseña"
      intro="Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una contraseña nueva."
    >
      {general ? <StatusMessage kind="error">{general}</StatusMessage> : null}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <ErrorSummary
          attempt={attempt}
          errors={error ? [{ fieldId: 'correo', message: error }] : []}
        />
        <Field
          id="correo"
          name="correo"
          label="Correo electrónico"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={correo}
          onChange={(event) => setCorreo(event.target.value)}
          error={error}
        />
        <Button type="submit" busy={busy} block>
          Enviar el enlace
        </Button>
      </form>
      <p className="cuenta-alternativa">
        <a href="/acceso">Volver a iniciar sesión</a>
      </p>
    </AccountShell>
  );
}
