import { describe, expect, it } from '@jest/globals';
import { PiiCipher } from './pii-cipher.js';

// T007 — cifrado por columna AES-256-GCM con versión de clave e índice ciego (research D-11).
const key1 = 'solo_pruebas_locales_clave_pii_version_1';
const key2 = 'solo_pruebas_locales_clave_pii_version_2';
const indexKey = 'solo_pruebas_locales_clave_indice_correo';
const cipher = new PiiCipher({ keys: { 1: key1 }, indexKey });

describe('cifrado de columnas', () => {
  it('ida y vuelta con el formato v<clave>:<iv>:<texto>:<etiqueta>', () => {
    const sealed = cipher.encrypt('Ana Pérez', 'persona.nombre');
    expect(sealed).toMatch(/^v1:[\w-]{16}:[\w-]+:[\w-]{22}$/);
    expect(sealed).not.toContain('Ana');
    expect(cipher.decrypt(sealed, 'persona.nombre')).toBe('Ana Pérez');
  });

  it('cada cifrado usa un IV nuevo: el mismo texto da resultados distintos', () => {
    expect(cipher.encrypt('igual', 'c')).not.toBe(cipher.encrypt('igual', 'c'));
  });

  it('cifra texto vacío y Unicode sin perder nada', () => {
    for (const text of ['', '😀 ñandú — 東京'])
      expect(cipher.decrypt(cipher.encrypt(text, 'c'), 'c')).toBe(text);
  });

  it('detecta cualquier manipulación del texto, del IV o de la etiqueta', () => {
    const [version, iv, text, tag] = cipher.encrypt('secreto', 'c').split(':') as [
      string,
      string,
      string,
      string,
    ];
    const flip = (value: string) => `${value.startsWith('A') ? 'B' : 'A'}${value.slice(1)}`;
    for (const tampered of [
      [version, flip(iv), text, tag],
      [version, iv, flip(text), tag],
      [version, iv, text, flip(tag)],
    ])
      expect(() => cipher.decrypt(tampered.join(':'), 'c')).toThrow(/no se pudo descifrar/i);
  });

  it('une el texto a su columna: un valor movido a otra columna no se descifra', () => {
    const sealed = cipher.encrypt('ana@ejemplo.com', 'persona.correo');
    expect(() => cipher.decrypt(sealed, 'persona.telefono')).toThrow(/no se pudo descifrar/i);
  });

  it.each(['', 'v1', 'v1:a:b', 'x1:a:b:c', 'v1:a:b:c:d'])('rechaza el formato «%s»', (value) => {
    expect(() => cipher.decrypt(value, 'c')).toThrow(/formato/i);
  });

  it('un error de descifrado nunca incluye el texto ni la clave', () => {
    try {
      cipher.decrypt(cipher.encrypt('dato-sensible', 'a'), 'b');
    } catch (error) {
      const message = String(error);
      expect(message).not.toContain('dato-sensible');
      expect(message).not.toContain(key1);
    }
  });
});

describe('rotación de claves', () => {
  const rotated = new PiiCipher({ keys: { 1: key1, 2: key2 }, indexKey });

  it('cifra con la versión más reciente y descifra las anteriores', () => {
    const old = cipher.encrypt('antiguo', 'c');
    expect(old.startsWith('v1:')).toBe(true);
    expect(rotated.encrypt('nuevo', 'c').startsWith('v2:')).toBe(true);
    expect(rotated.decrypt(old, 'c')).toBe('antiguo');
  });

  it('indica qué valores hay que recifrar', () => {
    expect(rotated.needsRotation(cipher.encrypt('x', 'c'))).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt('x', 'c'))).toBe(false);
  });

  it('una versión de clave desconocida falla con un mensaje claro', () => {
    expect(() => cipher.decrypt(rotated.encrypt('x', 'c'), 'c')).toThrow(/versión de clave/i);
  });

  it('las claves de versiones distintas no son intercambiables', () => {
    const forged = cipher.encrypt('x', 'c').replace(/^v1:/, 'v2:');
    expect(() => rotated.decrypt(forged, 'c')).toThrow(/no se pudo descifrar/i);
  });
});

describe('índice ciego del correo', () => {
  it('es determinista y normaliza el correo', () => {
    expect(cipher.blindIndex('Ana@Ejemplo.com')).toBe(cipher.blindIndex('  ana@ejemplo.COM '));
    expect(cipher.blindIndex('ana@ejemplo.com')).not.toBe(cipher.blindIndex('otra@ejemplo.com'));
  });

  it('no revela el correo y depende de la clave de índice', () => {
    const index = cipher.blindIndex('ana@ejemplo.com');
    expect(index).toMatch(/^[0-9a-f]{64}$/);
    expect(index).not.toContain('ana');
    const other = new PiiCipher({ keys: { 1: key1 }, indexKey: `${indexKey}_distinta` });
    expect(other.blindIndex('ana@ejemplo.com')).not.toBe(index);
  });

  it('no cambia al rotar las claves de cifrado', () => {
    const rotated = new PiiCipher({ keys: { 1: key1, 2: key2 }, indexKey });
    expect(rotated.blindIndex('ana@ejemplo.com')).toBe(cipher.blindIndex('ana@ejemplo.com'));
  });
});

describe('configuración', () => {
  it('exige al menos una clave y claves de 32 caracteres o más', () => {
    expect(() => new PiiCipher({ keys: {}, indexKey })).toThrow(/clave/i);
    expect(() => new PiiCipher({ keys: { 1: 'corta' }, indexKey })).toThrow(/32/);
    expect(() => new PiiCipher({ keys: { 1: key1 }, indexKey: 'corta' })).toThrow(/32/);
  });
});
