'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { correoRequest } from '@cafeteria/contracts/cuenta';
import { AccountShell, Button, ErrorSummary, Field, StatusMessage } from '@cafeteria/ui';
import { llamar, validar } from '../cliente-api.ts';

// La confirmación NO se hace al abrir el enlace sino al pulsar el botón: así los antivirus y las
// vistas previas de los correos, que abren los enlaces solos, no gastan el enlace de un solo uso.
export function Confirmar({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'bad'>('idle');
  const [message, setMessage] = useState('');

  async function confirm() {
    setState('busy');
    const result = await llamar('confirmar-correo', { body: { token } });
    if (result.ok) return setState('ok');
    setMessage(result.error.mensaje);
    setState('bad');
  }

  if (state === 'ok')
    return (
      <AccountShell title="Correo confirmado">
        <StatusMessage kind="ok">Tu cuenta quedó activa. Ya puedes iniciar sesión.</StatusMessage>
        <p className="cuenta-alternativa">
          <a href="/acceso">Iniciar sesión</a>
        </p>
      </AccountShell>
    );

  if (!token || state === 'bad')
    return (
      <AccountShell
        title={token ? 'No pudimos confirmar tu correo' : 'Pedir un enlace de confirmación'}
        {...(token
          ? {}
          : {
              intro: 'Escribe el correo con el que te registraste y te enviaremos un enlace nuevo.',
            })}
      >
        {state === 'bad' ? <StatusMessage kind="error">{message}</StatusMessage> : null}
        <Reenviar />
      </AccountShell>
    );

  return (
    <AccountShell title="Confirmar tu correo" intro="Un último paso para activar tu cuenta.">
      <Button type="button" busy={state === 'busy'} block onClick={() => void confirm()}>
        Confirmar mi correo
      </Button>
    </AccountShell>
  );
}

function Reenviar() {
  const [correo, setCorreo] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = validar(correoRequest, { correo });
    if (!checked.ok) return setError(checked.campos['correo']);
    setError(undefined);
    setBusy(true);
    const result = await llamar('reenviar-confirmacion', { body: checked.data });
    setBusy(false);
    if (result.ok) return setSent(true);
    setError(result.error.mensaje);
  }

  if (sent)
    return (
      <StatusMessage kind="ok">
        Si la cuenta existe y falta confirmarla, te enviamos un enlace nuevo. Revisa tu correo.
      </StatusMessage>
    );

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <ErrorSummary errors={error ? [{ fieldId: 'correo', message: error }] : []} />
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
        Enviar un enlace nuevo
      </Button>
    </form>
  );
}
