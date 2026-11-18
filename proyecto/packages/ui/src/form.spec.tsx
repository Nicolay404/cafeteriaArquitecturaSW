import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AccountShell,
  Button,
  Checkbox,
  ErrorSummary,
  Field,
  PasswordField,
  StatusMessage,
} from './index.js';

// T010 — componentes de formulario accesibles y tokens con contraste AAA medido.
const html = (node: ReactElement) => renderToStaticMarkup(node);

describe('Field', () => {
  it('ata etiqueta visible, ayuda y error con el campo', () => {
    const out = html(
      <Field
        id="correo"
        name="correo"
        label="Correo electrónico"
        type="email"
        autoComplete="username"
        hint="Usa el correo con el que te registraste."
        error="Escribe un correo con el formato nombre@dominio.com."
        required
      />,
    );
    expect(out).toContain('<label for="correo">Correo electrónico');
    expect(out).toContain('(obligatorio)');
    expect(out).toContain('id="correo"');
    expect(out).toMatch(/autocomplete="username"/i);
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="correo-ayuda correo-error"');
    expect(out).toContain('id="correo-error"');
    expect(out).toContain('Error: ');
  });

  it('sin ayuda ni error no declara aria-invalid ni aria-describedby', () => {
    const out = html(<Field id="n" name="n" label="Nombre" />);
    expect(out).not.toContain('aria-invalid');
    expect(out).not.toContain('aria-describedby');
    expect(out).not.toContain('(obligatorio)');
  });

  it('el error no depende solo del color: lleva icono y texto «Error:»', () => {
    const out = html(<Field id="n" name="n" label="Nombre" error="Escribe tu nombre." />);
    expect(out).toContain('⚠');
    expect(out).toMatch(/Error: <\/span>Escribe tu nombre\./);
  });
});

describe('Checkbox', () => {
  it('tiene etiqueta visible enlazada y error propio', () => {
    const out = html(
      <Checkbox id="acepto" name="acepto" label="Acepto la política" error="Debes aceptarla." />,
    );
    expect(out).toContain('<label for="acepto">Acepto la política</label>');
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="acepto-error"');
    expect(out).toContain('Error: ');
  });

  it('sin error no declara aria-invalid', () => {
    expect(html(<Checkbox id="a" name="a" label="x" />)).not.toContain('aria-invalid');
  });
});

describe('PasswordField', () => {
  it('empieza oculta y el botón expone su estado y qué controla', () => {
    const out = html(
      <PasswordField id="clave" name="clave" label="Contraseña" autoComplete="new-password" />,
    );
    expect(out).toContain('type="password"');
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain('aria-controls="clave"');
    expect(out).toContain('Mostrar');
    expect(out).toContain('type="button"');
  });
});

describe('ErrorSummary', () => {
  it('no pinta nada sin errores', () => {
    expect(html(<ErrorSummary errors={[]} />)).toBe('');
  });

  it('enlaza cada error a su campo y es enfocable por programa', () => {
    const out = html(
      <ErrorSummary
        errors={[
          { fieldId: 'correo', message: 'Escribe un correo válido.' },
          { fieldId: 'clave', message: 'Usa al menos 12 caracteres.' },
        ]}
      />,
    );
    expect(out).toContain('tabindex="-1"');
    expect(out).toContain('Hay 2 errores que corregir');
    expect(out).toContain('<a href="#correo">Escribe un correo válido.</a>');
    expect(out).toContain('<a href="#clave">');
  });

  it('usa el singular con un solo error', () => {
    expect(html(<ErrorSummary errors={[{ fieldId: 'a', message: 'x' }]} />)).toContain(
      'Hay 1 error que corregir',
    );
  });
});

describe('Button, StatusMessage y AccountShell', () => {
  it('el botón ocupado se anuncia y no admite un segundo envío', () => {
    const out = html(
      <Button type="submit" busy>
        Crear cuenta
      </Button>,
    );
    expect(out).toContain('disabled');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('Enviando…');
    expect(out).not.toContain('Crear cuenta');
  });

  it('la variante secundaria y el bloque cambian solo las clases', () => {
    const out = html(
      <Button variant="secondary" block>
        Cancelar
      </Button>,
    );
    expect(out).toContain('boton boton-secundario boton-bloque');
    expect(out).toContain('type="button"');
  });

  it('la confirmación es un <output> (rol status nativo) y el fallo role=alert', () => {
    expect(html(<StatusMessage kind="ok">Guardado</StatusMessage>)).toContain('<output');
    expect(html(<StatusMessage kind="error">Falló</StatusMessage>)).toContain('role="alert"');
  });

  it('el marco tiene un único h1 y la frase que explica la pantalla', () => {
    const out = html(
      <AccountShell title="Crear cuenta" intro="Te enviaremos un correo.">
        x
      </AccountShell>,
    );
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain('Te enviaremos un correo.');
  });
});

// Guardia de contraste: lee los tokens reales del CSS y recalcula las razones WCAG, de modo que
// cambiar un color por debajo de AAA haga fallar el test.
describe('contraste de los tokens (WCAG 2.2 AAA)', () => {
  const css = readFileSync(new URL('./ui.css', import.meta.url), 'utf8');
  const token = (name: string) => {
    const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
    if (!match) throw new Error(`Falta el token --${name}`);
    return match[1]!;
  };
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(token(a)), luminance(token(b))].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  it.each([
    ['tinta', 'crema'],
    ['tinta', 'superficie'],
    ['tinta', 'tinte'],
    ['tinta-suave', 'crema'],
    ['tinta-suave', 'tinte'],
    ['superficie', 'cafe'],
    ['superficie', 'cafe-oscuro'],
    ['superficie', 'tinta-suave'],
    ['cafe', 'tinte'],
    ['enlace', 'crema'],
    ['enlace', 'superficie'],
    ['error', 'crema'],
    ['error', 'superficie'],
    ['exito', 'crema'],
    ['exito', 'tinte'],
    ['exito', 'superficie'],
  ])('texto %s sobre %s llega a 7:1', (foreground, background) => {
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(7);
  });

  it.each([
    ['borde', 'superficie'],
    ['borde', 'crema'],
    ['foco', 'crema'],
    ['foco', 'superficie'],
    ['cafe', 'crema'],
  ])('el elemento %s sobre %s llega a 3:1', (foreground, background) => {
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(3);
  });

  it('respeta prefers-reduced-motion y los objetivos de 44 px', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*transform: none/);
    expect(css).toMatch(/\.boton\s*\{[^}]*min-height: 3rem/);
    expect(css).toMatch(/\.campo input\s*\{[^}]*min-height: 3rem/);
  });
});
