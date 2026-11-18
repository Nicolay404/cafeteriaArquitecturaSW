import { describe, expect, it } from 'vitest';
import {
  accesoRequest,
  camposDeError,
  cambioContrasenaRequest,
  eliminacionRequest,
  mfaVerificarRequest,
  pedidoResumen,
  perfilPatch,
  registroRequest,
  restablecerRequest,
} from '../../packages/contracts/src/index.js';

// T004 — esquemas compartidos del contrato del Spec #2.
const valido = {
  nombre: '  Ana  ',
  correo: '  Ana@Ejemplo.COM ',
  contrasena: 'una frase bastante larga',
  aceptaPolitica: true,
};

describe('registro', () => {
  it('normaliza correo y nombre', () => {
    expect(registroRequest.parse(valido)).toMatchObject({
      nombre: 'Ana',
      correo: 'ana@ejemplo.com',
    });
  });

  it('exige aceptar la política de privacidad', () => {
    const result = registroRequest.safeParse({ ...valido, aceptaPolitica: false });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(camposDeError(result.error).campos).toContainEqual({
        campo: 'aceptaPolitica',
        mensaje: expect.stringMatching(/política de privacidad/) as string,
      });
  });

  it.each([
    ['11 caracteres', 'a'.repeat(11), /al menos 12/],
    ['129 caracteres', 'a'.repeat(129), /como máximo 128/],
  ])('rechaza una contraseña de %s y dice cómo corregirla', (_, contrasena, pattern) => {
    const result = registroRequest.safeParse({ ...valido, contrasena });
    expect(result.success).toBe(false);
    if (!result.success) expect(camposDeError(result.error).campos?.[0]?.mensaje).toMatch(pattern);
  });

  it('cuenta los caracteres tras normalizar con NFKC', () => {
    // «ﬁ» (U+FB01) se descompone en «fi»: 6 ligaduras son 12 caracteres.
    expect(registroRequest.safeParse({ ...valido, contrasena: 'ﬁ'.repeat(6) }).success).toBe(true);
  });

  it.each(['sin-arroba', 'a@', `${'a'.repeat(250)}@x.ec`])('rechaza el correo %s', (correo) => {
    expect(registroRequest.safeParse({ ...valido, correo }).success).toBe(false);
  });
});

describe('acceso, recuperación y MFA', () => {
  it('el acceso no aplica la política de longitud (no revela nada)', () => {
    expect(accesoRequest.safeParse({ correo: 'a@b.ec', contrasena: 'corta' }).success).toBe(true);
    expect(accesoRequest.safeParse({ correo: 'a@b.ec', contrasena: '' }).success).toBe(false);
  });

  it('el token de un solo uso tiene 43 caracteres base64url', () => {
    const contrasena = 'otra frase bastante larga';
    expect(restablecerRequest.safeParse({ token: 'a'.repeat(43), contrasena }).success).toBe(true);
    expect(restablecerRequest.safeParse({ token: 'a'.repeat(42), contrasena }).success).toBe(false);
    expect(restablecerRequest.safeParse({ token: `${'a'.repeat(42)}=`, contrasena }).success).toBe(
      false,
    );
  });

  it('MFA acepta un código de 6 dígitos o uno de recuperación', () => {
    expect(mfaVerificarRequest.safeParse({ codigo: '123456' }).success).toBe(true);
    expect(mfaVerificarRequest.safeParse({ codigoRecuperacion: 'ab3de-fg5ij' }).success).toBe(true);
    expect(mfaVerificarRequest.safeParse({ codigo: '12345' }).success).toBe(false);
  });
});

describe('clientes', () => {
  it('el perfil rechaza campos desconocidos (no se puede cambiar el rol)', () => {
    expect(perfilPatch.safeParse({ rol: 'admin' }).success).toBe(false);
    expect(perfilPatch.safeParse({ nombre: 'Ana', telefono: '+593991234567' }).success).toBe(true);
    expect(perfilPatch.safeParse({ telefono: '0991234567' }).success).toBe(false);
  });

  it('el cambio de contraseña aplica la política a la nueva', () => {
    expect(cambioContrasenaRequest.safeParse({ actual: 'x', nueva: 'corta' }).success).toBe(false);
  });

  it('el total del pedido es un entero en centavos', () => {
    const base = { id: 'p1', fecha: '2026-11-18T12:00:00Z', estado: 'entregado' };
    expect(pedidoResumen.safeParse({ ...base, totalCentavos: 450 }).success).toBe(true);
    expect(pedidoResumen.safeParse({ ...base, totalCentavos: 4.5 }).success).toBe(false);
  });

  it('eliminar la cuenta exige escribir ELIMINAR', () => {
    expect(eliminacionRequest.safeParse({ confirmacion: 'eliminar' }).success).toBe(false);
    expect(eliminacionRequest.safeParse({ confirmacion: 'ELIMINAR' }).success).toBe(true);
  });
});
