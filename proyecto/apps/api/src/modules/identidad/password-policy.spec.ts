import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { HibpChecker, PasswordPolicy, localWeakness } from './password-policy.js';
import type { BreachChecker } from './password-policy.js';

// T015 — política de contraseñas (FR-004, research D-04/D-05): 12–128 caracteres sin reglas de
// composición, rechazo de las comunes y de las filtradas, sin depender de una red externa.
const never: BreachChecker = { isBreached: async () => false };
const strong = 'cafe con leche y pan tostado';

describe('longitud y normalización', () => {
  const policy = new PasswordPolicy(never);

  it('acepta una frase larga sin mayúsculas, números ni símbolos', async () => {
    expect(await policy.check(strong)).toEqual({ ok: true, brechas: 'comprobada' });
  });

  it.each([
    ['11 caracteres', 'a1b2c3d4e5f', 'corta'],
    ['vacía', '', 'corta'],
    ['129 caracteres', 'ab'.repeat(64) + 'c', 'larga'],
  ])('rechaza una contraseña %s', async (_name, password, motivo) => {
    expect(await policy.check(password)).toMatchObject({ ok: false, motivo });
  });

  it('cuenta los caracteres tras normalizar con NFKC', async () => {
    // Seis ligaduras «ﬁ» son doce caracteres tras NFKC: no es «corta» (sí es una repetición trivial).
    const six = await policy.check('ﬁ'.repeat(6));
    expect(six).toMatchObject({ ok: false, motivo: 'comun' });
    expect(await policy.check(`${'ﬁ'.repeat(4)}ordinal zzz`)).toMatchObject({ ok: true });
  });

  it('cuenta caracteres, no bytes: 12 letras acentuadas son 12', async () => {
    expect(await policy.check('ñandúñandúña')).not.toMatchObject({ motivo: 'corta' });
  });
});

describe('contraseñas comunes y patrones', () => {
  it.each([
    'passwordpassword',
    'Password1234',
    'P@ssw0rd12345',
    'contraseña1234',
    'Contrasena123456',
    'qwertyuiop12',
    'qwerty123456',
    '1234567890123',
    '123456789012',
    'abcdefghijkl',
    'aaaaaaaaaaaa',
    'cafeteria2026',
    'iloveyou12345',
    'administrador1',
    'letmein123456',
    'bienvenido2026',
  ])('rechaza «%s» como contraseña común o predecible', async (password) => {
    expect(await new PasswordPolicy(never).check(password)).toMatchObject({
      ok: false,
      motivo: 'comun',
    });
  });

  it.each(['cafe con leche y pan tostado', 'correct horse battery staple', 'xK9#mPq2$vL7wRt4'])(
    'acepta «%s»',
    async (password) => {
      expect(await new PasswordPolicy(never).check(password)).toMatchObject({ ok: true });
    },
  );

  it('una palabra común dentro de una frase larga no la invalida', () => {
    expect(localWeakness('el password de mi abuela es una receta de sopa')).toBeNull();
  });
});

describe('datos de la propia persona', () => {
  const policy = new PasswordPolicy(never);

  it('rechaza una contraseña que contiene la parte local del correo', async () => {
    expect(
      await policy.check('mariaperez-2026-xyz', { correo: 'mariaperez@ejemplo.com' }),
    ).toMatchObject({ ok: false, motivo: 'personal' });
  });

  it('rechaza una que contiene el nombre', async () => {
    expect(await policy.check('soy-Valentina-siempre', { nombre: 'Valentina Ruiz' })).toMatchObject(
      {
        ok: false,
        motivo: 'personal',
      },
    );
  });

  it('ignora fragmentos de menos de 4 caracteres (no bloquea por «Ana» o «Li»)', async () => {
    expect(await policy.check('anaquel de la despensa vieja', { nombre: 'Ana Li' })).toMatchObject({
      ok: true,
    });
  });
});

describe('contraseñas filtradas', () => {
  it('rechaza lo que el comprobador marca como filtrado', async () => {
    const checker: BreachChecker = { isBreached: async () => true };
    expect(await new PasswordPolicy(checker).check(strong)).toMatchObject({
      ok: false,
      motivo: 'filtrada',
    });
  });

  it('si el servicio externo falla, acepta lo que pasó la lista local y lo declara', async () => {
    const checker: BreachChecker = {
      isBreached: async () => {
        throw new Error('sin red');
      },
    };
    const onUnavailable = jest.fn();
    const policy = new PasswordPolicy(checker, onUnavailable);
    expect(await policy.check(strong)).toEqual({ ok: true, brechas: 'omitida' });
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('las comunes se rechazan sin consultar al servicio externo', async () => {
    const isBreached = jest.fn(async () => false);
    await new PasswordPolicy({ isBreached }).check('passwordpassword');
    expect(isBreached).not.toHaveBeenCalled();
  });

  it('sin comprobador externo solo aplica la lista local', async () => {
    expect(await new PasswordPolicy().check(strong)).toEqual({ ok: true, brechas: 'omitida' });
  });
});

describe('HibpChecker (k-anonimato)', () => {
  const sha1 = (text: string) => createHash('sha1').update(text).digest('hex').toUpperCase();
  const password = 'cafe con leche y pan tostado';
  const digest = sha1(password);
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  it('envía solo los 5 primeros caracteres del SHA-1 y pide relleno', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const checker = new HibpChecker({
      fetch: async (url, init) => {
        calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
        return new Response(`${'0'.repeat(35)}:1\r\n${suffix}:42\r\n`);
      },
    });
    expect(await checker.isBreached(password)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    expect(calls[0]!.url).not.toContain(suffix);
    expect(calls[0]!.headers['Add-Padding']).toBe('true');
  });

  it('una coincidencia con cantidad 0 (relleno) no cuenta como filtrada', async () => {
    const checker = new HibpChecker({ fetch: async () => new Response(`${suffix}:0\r\n`) });
    expect(await checker.isBreached(password)).toBe(false);
  });

  it('si el sufijo no está en la respuesta, no está filtrada', async () => {
    const checker = new HibpChecker({
      fetch: async () => new Response(`${'A'.repeat(35)}:7\r\n`),
    });
    expect(await checker.isBreached(password)).toBe(false);
  });

  it('un error HTTP o de red se propaga para que la política lo declare como omitido', async () => {
    const http = new HibpChecker({ fetch: async () => new Response('x', { status: 503 }) });
    await expect(http.isBreached(password)).rejects.toThrow(/503/);
    const network = new HibpChecker({
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(network.isBreached(password)).rejects.toThrow();
  });

  it('respeta el tiempo máximo de espera', async () => {
    const slow = new HibpChecker({
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('abortado')));
        }),
    });
    await expect(slow.isBreached(password)).rejects.toThrow();
  });
});
