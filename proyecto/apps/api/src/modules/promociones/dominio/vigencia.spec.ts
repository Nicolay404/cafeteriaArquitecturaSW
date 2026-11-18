import { describe, expect, it } from '@jest/globals';
import { FechaInvalida, estaVigente, localAUtc, utcALocal, ZONA_CAFETERIA } from './vigencia.js';

const ventana = {
  inicio: new Date('2026-12-20T05:00:00.000Z'), // 20/12 00:00 en Guayaquil (UTC−5)
  fin: new Date('2026-12-26T05:00:00.000Z'), // 26/12 00:00 en Guayaquil
};

describe('estaVigente: ventana semiabierta [inicio, fin)', () => {
  it.each([
    ['un milisegundo antes del inicio', '2026-12-20T04:59:59.999Z', false],
    ['justo en el inicio', '2026-12-20T05:00:00.000Z', true],
    ['en medio', '2026-12-23T15:00:00.000Z', true],
    ['un milisegundo antes del fin', '2026-12-26T04:59:59.999Z', true],
    ['justo en el fin', '2026-12-26T05:00:00.000Z', false],
    ['después del fin', '2027-01-01T00:00:00.000Z', false],
  ])('%s → %p', (_caso, instante, esperado) => {
    expect(estaVigente({ ...ventana, estado: 'activa' }, new Date(instante))).toBe(esperado);
  });

  it.each(['pausada', 'archivada'] as const)('una promoción %s nunca está vigente', (estado) => {
    expect(estaVigente({ ...ventana, estado }, new Date('2026-12-23T15:00:00.000Z'))).toBe(false);
  });
});

describe('hora local de la cafetería', () => {
  it('usa America/Guayaquil por defecto', () => {
    expect(ZONA_CAFETERIA).toBe('America/Guayaquil');
  });

  it('convierte hora local de Guayaquil a UTC (UTC−5, sin horario de verano)', () => {
    expect(localAUtc('2026-12-20T00:00').toISOString()).toBe('2026-12-20T05:00:00.000Z');
    expect(localAUtc('2026-06-15T23:30').toISOString()).toBe('2026-06-16T04:30:00.000Z');
  });

  it('respeta el horario de verano en otra zona configurada', () => {
    // Madrid: invierno UTC+1, verano UTC+2
    expect(localAUtc('2026-01-10T10:00', 'Europe/Madrid').toISOString()).toBe(
      '2026-01-10T09:00:00.000Z',
    );
    expect(localAUtc('2026-07-10T10:00', 'Europe/Madrid').toISOString()).toBe(
      '2026-07-10T08:00:00.000Z',
    );
  });

  it('convierte UTC a hora local y es la inversa de localAUtc', () => {
    expect(utcALocal(new Date('2026-12-20T05:00:00.000Z'))).toBe('2026-12-20T00:00');
    for (const local of ['2026-01-01T00:00', '2026-05-12T07:45', '2026-12-31T23:59']) {
      expect(utcALocal(localAUtc(local))).toBe(local);
    }
  });

  it.each(['2026-12-20', '20/12/2026 10:00', '2026-02-30T10:00', '2026-12-20T24:00', ''])(
    'rechaza la fecha local %p con un mensaje que indica el formato',
    (texto) => {
      expect(() => localAUtc(texto)).toThrow(FechaInvalida);
      expect(() => localAUtc(texto)).toThrow(/AAAA-MM-DDTHH:mm/);
    },
  );

  it('rechaza una zona horaria desconocida', () => {
    expect(() => localAUtc('2026-12-20T00:00', 'Marte/Olimpo')).toThrow(FechaInvalida);
  });
});
