'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { accesoRequest } from '@cafeteria/contracts/cuenta';
import {
  AccountShell,
  Button,
  ErrorSummary,
  Field,
  PasswordField,
  StatusMessage,
} from '@cafeteria/ui';
import { camposPorNombre, esperaLegible, llamar, validar } from '../cliente-api.ts';

interface AccesoOk {
  requiereMfa: boolean;
  rol: string;
}

export function FormularioAcceso() {
  const [values, setValues] = useState({ correo: '', contrasena: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);

  const change = (name: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [name]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setGeneral(null);
    setNeedsConfirmation(false);
    const checked = validar(accesoRequest, values);
    if (!checked.ok) return setErrors(checked.campos);
    setErrors({});
    setBusy(true);
    const result = await llamar<AccesoOk>('acceso', { body: checked.data });
    setBusy(false);
    if (result.ok) {
      if (result.data.requiereMfa)
        return setGeneral({
          kind: 'error',
          text: 'Tu cuenta necesita verificar un segundo factor de autenticación. Esa pantalla todavía no está disponible.',
        });
      // Navegación completa: así la cabecera lee la cookie recién creada.
      window.location.assign('/cuenta');
      return;
    }
    if (result.error.campos?.length) return setErrors(camposPorNombre(result.error.campos));
    if (result.error.codigo === 'correo_sin_confirmar') setNeedsConfirmation(true);
    setGeneral({
      kind: 'error',
      text:
        result.status === 429
          ? `Demasiados intentos. Por seguridad, espera ${esperaLegible(result.retryAfterSeconds)} antes de volver a intentarlo. Te avisamos por correo.`
          : result.error.mensaje,
    });
  }

  const list = [
    ...(errors['correo'] ? [{ fieldId: 'correo', message: errors['correo'] }] : []),
    ...(errors['contrasena'] ? [{ fieldId: 'contrasena', message: errors['contrasena'] }] : []),
  ];

  return (
    <AccountShell title="Iniciar sesión" intro="Entra para hacer tus pedidos y ver tu historial.">
      {general ? <StatusMessage kind={general.kind}>{general.text}</StatusMessage> : null}
      {needsConfirmation ? (
        <p>
          <a href="/confirmar">Pedir un nuevo enlace de confirmación</a>
        </p>
      ) : null}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <ErrorSummary errors={list} />
        <Field
          id="correo"
          name="correo"
          label="Correo electrónico"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={values.correo}
          onChange={change('correo')}
          error={errors['correo']}
        />
        <PasswordField
          id="contrasena"
          name="contrasena"
          label="Contraseña"
          autoComplete="current-password"
          required
          value={values.contrasena}
          onChange={change('contrasena')}
          error={errors['contrasena']}
        />
        <Button type="submit" busy={busy} block>
          Iniciar sesión
        </Button>
      </form>
      <p className="cuenta-alternativa">
        <a href="/recuperar">Olvidé mi contraseña</a>
      </p>
      <p>
        ¿Aún no tienes cuenta? <a href="/registro">Crea una</a>
      </p>
    </AccountShell>
  );
}
