'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { registroRequest } from '@cafeteria/contracts/cuenta';
import {
  AccountShell,
  Button,
  Checkbox,
  ErrorSummary,
  Field,
  PasswordField,
  StatusMessage,
} from '@cafeteria/ui';
import { camposPorNombre, esperaLegible, llamar, validar } from '../cliente-api.ts';

const CAMPOS = [
  ['nombre', 'Nombre'],
  ['correo', 'Correo electrónico'],
  ['contrasena', 'Contraseña'],
  ['aceptaPolitica', 'Política de privacidad'],
] as const;

export function FormularioRegistro() {
  const [values, setValues] = useState({ nombre: '', correo: '', contrasena: '' });
  const [acepta, setAcepta] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const change = (name: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [name]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setGeneral(null);
    const checked = validar(registroRequest, { ...values, aceptaPolitica: acepta });
    if (!checked.ok) return setErrors(checked.campos);
    setErrors({});
    setBusy(true);
    const result = await llamar('registro', { body: checked.data });
    setBusy(false);
    if (result.ok) return setSent(checked.data.correo);
    if (result.error.campos?.length) return setErrors(camposPorNombre(result.error.campos));
    setGeneral(
      result.status === 429
        ? `Hubo demasiados intentos. Espera ${esperaLegible(result.retryAfterSeconds)} y vuelve a intentarlo.`
        : result.error.mensaje,
    );
  }

  if (sent)
    return (
      <AccountShell title="Revisa tu correo">
        <StatusMessage kind="ok">
          Si el correo es válido, enviamos un mensaje a <strong>{sent}</strong> para confirmar tu
          cuenta. El enlace caduca en 24 horas.
        </StatusMessage>
        <p className="cuenta-alternativa">
          ¿No llegó? Revisa la carpeta de correo no deseado o{' '}
          <a href="/confirmar">pide otro enlace</a>.
        </p>
      </AccountShell>
    );

  const list = CAMPOS.filter(([name]) => errors[name]).map(([name]) => ({
    fieldId: name === 'aceptaPolitica' ? 'aceptaPolitica' : name,
    message: errors[name]!,
  }));

  return (
    <AccountShell
      title="Crear cuenta"
      intro="Con tu cuenta podrás hacer pedidos y ver tu historial. Te pediremos solo lo necesario."
    >
      {general ? <StatusMessage kind="error">{general}</StatusMessage> : null}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <ErrorSummary errors={list} />
        <Field
          id="nombre"
          name="nombre"
          label="Nombre"
          autoComplete="name"
          required
          value={values.nombre}
          onChange={change('nombre')}
          error={errors['nombre']}
        />
        <Field
          id="correo"
          name="correo"
          label="Correo electrónico"
          type="email"
          autoComplete="email"
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
          autoComplete="new-password"
          hint="Mínimo 12 caracteres. Una frase larga que solo tú conozcas funciona mejor que símbolos."
          required
          value={values.contrasena}
          onChange={change('contrasena')}
          error={errors['contrasena']}
        />
        <Checkbox
          id="aceptaPolitica"
          name="aceptaPolitica"
          checked={acepta}
          onChange={(event) => setAcepta(event.target.checked)}
          error={errors['aceptaPolitica']}
          label={
            <>
              Acepto la política de privacidad, que explica qué datos guardamos y para qué
              (obligatorio).
            </>
          }
        />
        <Button type="submit" busy={busy} block>
          Crear cuenta
        </Button>
      </form>
      <p className="cuenta-alternativa">
        ¿Ya tienes cuenta? <a href="/acceso">Inicia sesión</a>
      </p>
    </AccountShell>
  );
}
