import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Acceso, { metadata as acceso } from './acceso/page.tsx';
import ConfirmarPagina, { metadata as confirmar } from './confirmar/page.tsx';
import Cuenta, { metadata as cuenta } from './cuenta/page.tsx';
import CuentaLayout from './layout.tsx';
import Recuperar, { metadata as recuperar } from './recuperar/page.tsx';
import Registro, { metadata as registro } from './registro/page.tsx';
import Restablecer, { metadata as restablecer } from './restablecer/page.tsx';

// Las páginas son componentes de servidor delgados: título propio, el formulario correcto y, las
// que llevan un token de un solo uso, sin indexar y sin enviar el Referer.
describe('páginas de cuenta', () => {
  it.each([
    [acceso, 'Iniciar sesión'],
    [registro, 'Crear cuenta'],
    [recuperar, 'Recuperar contraseña'],
    [confirmar, 'Confirmar correo'],
    [restablecer, 'Elegir contraseña nueva'],
    [cuenta, 'Mi cuenta'],
  ])('cada página tiene su propio título', (metadata, title) => {
    expect(String(metadata.title)).toBe(`${title} · Cafetería`);
  });

  it('las páginas con token no se indexan ni filtran la URL por Referer', () => {
    for (const metadata of [confirmar, restablecer]) {
      expect(metadata.referrer).toBe('no-referrer');
      expect(metadata.robots).toEqual({ index: false });
    }
    expect(cuenta.robots).toEqual({ index: false });
  });

  it('registro, acceso, recuperar y cuenta pintan su formulario', () => {
    expect(renderToStaticMarkup(<Registro />)).toContain('Crear cuenta');
    expect(renderToStaticMarkup(<Acceso />)).toContain('Iniciar sesión');
    expect(renderToStaticMarkup(<Recuperar />)).toContain('Recuperar contraseña');
    expect(renderToStaticMarkup(<Cuenta />)).toContain('Mi cuenta');
  });

  it('confirmar y restablecer leen el token de la URL; si falta o es doble, lo tratan como ausente', async () => {
    const withToken = await Restablecer({ searchParams: Promise.resolve({ token: 'abc' }) });
    expect(withToken.props.token).toBe('abc');
    const twice = await Restablecer({ searchParams: Promise.resolve({ token: ['a', 'b'] }) });
    expect(twice.props.token).toBe('');
    const missing = await ConfirmarPagina({ searchParams: Promise.resolve({}) });
    expect(missing.props.token).toBe('');
    const confirm = await ConfirmarPagina({ searchParams: Promise.resolve({ token: 'xyz' }) });
    expect(confirm.props.token).toBe('xyz');
  });

  it('el layout de cuenta es el único <main> y recibe el foco del enlace de salto', () => {
    const html = renderToStaticMarkup(<CuentaLayout>contenido</CuentaLayout>);
    expect(html).toContain('<main id="contenido" tabindex="-1"');
    expect(html).toContain('contenido');
  });
});
