'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEventHandler, ReactNode } from 'react';

// Componentes base de formulario (Spec #2, T010). Accesibilidad AAA por construcción: etiqueta
// visible siempre, ayuda y error ligados con aria-describedby, resumen de errores que recibe el
// foco, objetivos de 48 px y estados que no dependen solo del color. Los textos los pone quien
// llama; aquí no hay copy de negocio.

export interface FieldProps {
  id: string;
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'tel' | 'search';
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'numeric' | 'tel';
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  value?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  maxLength?: number;
}

export function Field({
  id,
  name,
  label,
  type = 'text',
  autoComplete,
  inputMode,
  hint,
  error,
  required,
  value,
  onChange,
  maxLength,
  action,
}: Readonly<FieldProps & { action?: ReactNode }>) {
  const hintId = hint ? `${id}-ayuda` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="campo">
      <label htmlFor={id}>
        {label}
        {required ? <span className="campo-obligatorio"> (obligatorio)</span> : null}
      </label>
      <div className={action ? 'campo-con-boton' : undefined}>
        <input
          id={id}
          name={name}
          type={type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          maxLength={maxLength}
          {...(value !== undefined ? { value } : {})}
          {...(onChange ? { onChange } : {})}
        />
        {action}
      </div>
      {hint ? (
        <p id={hintId} className="campo-ayuda">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="campo-error">
          <span aria-hidden="true">⚠ </span>
          <span className="solo-lectores">Error: </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Casilla con etiqueta visible; el texto puede llevar un enlace (p. ej. a la política de privacidad). */
export function Checkbox({
  id,
  name,
  label,
  error,
  checked,
  onChange,
}: Readonly<{
  id: string;
  name: string;
  label: ReactNode;
  error?: string | undefined;
  checked?: boolean;
  onChange?: ChangeEventHandler<HTMLInputElement>;
}>) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="campo">
      <div className="campo-casilla">
        <input
          id={id}
          name={name}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          {...(checked !== undefined ? { checked } : {})}
          {...(onChange ? { onChange } : {})}
        />
        <label htmlFor={id}>{label}</label>
      </div>
      {error ? (
        <p id={errorId} className="campo-error">
          <span aria-hidden="true">⚠ </span>
          <span className="solo-lectores">Error: </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Contraseña con botón para mostrarla u ocultarla: se puede revisar lo escrito antes de enviarlo. */
export function PasswordField(props: Readonly<Omit<FieldProps, 'type'>>) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      {...props}
      type={visible ? 'text' : 'password'}
      action={
        <button
          type="button"
          className="boton boton-secundario"
          aria-pressed={visible}
          aria-controls={props.id}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? 'Ocultar' : 'Mostrar'}
          <span className="solo-lectores"> contraseña</span>
        </button>
      }
    />
  );
}

export interface FormError {
  /** Id del campo con el problema, para enlazar el mensaje. */
  fieldId: string;
  message: string;
}

/**
 * Resumen al inicio del formulario. Toma el foco cuando APARECE o cuando se vuelve a intentar enviar
 * (cambia `attempt`), nunca en cada render: si lo hiciera, cada tecla escrita para corregir un
 * error devolvería el foco al resumen.
 */
export function ErrorSummary({
  errors,
  attempt = 0,
}: Readonly<{
  errors: readonly FormError[];
  attempt?: number;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  const hasErrors = errors.length > 0;
  useEffect(() => {
    if (hasErrors) ref.current?.focus();
  }, [attempt, hasErrors]);
  if (errors.length === 0) return null;
  return (
    <div
      ref={ref}
      className="resumen-errores"
      tabIndex={-1}
      aria-labelledby="resumen-errores-titulo"
    >
      <h2 id="resumen-errores-titulo">
        {errors.length === 1
          ? 'Hay 1 error que corregir'
          : `Hay ${errors.length} errores que corregir`}
      </h2>
      <ul>
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a href={`#${error.fieldId}`}>{error.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  busy = false,
  block = false,
  onClick,
}: Readonly<{
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  type?: 'button' | 'submit';
  /** Enviando: se anuncia y no admite un segundo envío. */
  busy?: boolean;
  block?: boolean;
  onClick?: () => void;
}>) {
  const className = [
    'boton',
    variant === 'secondary' ? 'boton-secundario' : '',
    block ? 'boton-bloque' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={className}
      aria-disabled={busy || undefined}
      disabled={busy}
      {...(onClick ? { onClick } : {})}
    >
      {busy ? 'Enviando…' : children}
    </button>
  );
}

/** Confirmación o fallo general. Nunca desaparece sola: sin límites de tiempo (WCAG 2.2.3). */
export function StatusMessage({
  kind,
  children,
}: Readonly<{ kind: 'ok' | 'error'; children: ReactNode }>) {
  if (kind === 'error')
    return (
      <div className="estado estado-error" role="alert">
        <span aria-hidden="true">⚠ </span>
        {children}
      </div>
    );
  // <output> tiene el rol «status» de forma nativa (anuncia el cambio sin interrumpir).
  return (
    <output className="estado">
      <span aria-hidden="true">✓ </span>
      {children}
    </output>
  );
}

/** Marco de una pantalla de cuenta: un h1, una frase que dice qué pasa y el contenido. */
export function AccountShell({
  title,
  intro,
  children,
}: Readonly<{
  title: string;
  intro?: string;
  children: ReactNode;
}>) {
  return (
    <div className="cuenta">
      <div className="cuenta-marco">
        <h1>{title}</h1>
        {intro ? <p className="cuenta-intro">{intro}</p> : null}
        {children}
      </div>
    </div>
  );
}
