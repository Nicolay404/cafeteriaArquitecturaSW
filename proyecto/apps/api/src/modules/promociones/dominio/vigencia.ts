// Ventanas de vigencia y hora local de la cafetería (research.md R4).
// La ventana es semiabierta [inicio, fin) en instantes UTC y se evalúa en cada cálculo con el
// instante del servidor: no hace falta un job que «active» promociones (FR-005).
// El administrador trabaja en hora local; la conversión usa Intl, válida también con horario
// de verano si algún día se configura otra zona.

import type { EstadoPromocion } from './tipos.js';

export const ZONA_CAFETERIA = 'America/Guayaquil';

export class FechaInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'FechaInvalida';
  }
}

export interface Ventana {
  readonly inicio: Date;
  readonly fin: Date;
  readonly estado: EstadoPromocion;
}

/** Una promoción solo está vigente si está activa y `inicio ≤ instante < fin`. */
export function estaVigente(promocion: Ventana, instante: Date): boolean {
  const t = instante.getTime();
  return (
    promocion.estado === 'activa' && promocion.inicio.getTime() <= t && t < promocion.fin.getTime()
  );
}

const FORMATO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const AYUDA_FORMATO =
  'Use el formato AAAA-MM-DDTHH:mm en hora local de la cafetería, p. ej. 2026-12-20T08:00.';

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string): Intl.DateTimeFormat {
  let fmt = formateadores.get(zona);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: zona,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      throw new FechaInvalida(`Zona horaria desconocida: «${zona}».`);
    }
    formateadores.set(zona, fmt);
  }
  return fmt;
}

interface PartesFecha {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

function partesEnZona(instanteMs: number, zona: string): PartesFecha {
  const valores = new Map(
    formateador(zona)
      .formatToParts(new Date(instanteMs))
      .map((parte) => [parte.type, Number(parte.value)]),
  );
  const leer = (tipo: Intl.DateTimeFormatPartTypes): number => valores.get(tipo) ?? 0;
  return {
    anio: leer('year'),
    mes: leer('month'),
    dia: leer('day'),
    hora: leer('hour'),
    minuto: leer('minute'),
    segundo: leer('second'),
  };
}

/** Diferencia (ms) entre la hora local de `zona` y UTC en ese instante. */
function desfase(instanteMs: number, zona: string): number {
  const p = partesEnZona(instanteMs, zona);
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instanteMs / 1000) * 1000;
}

/** Convierte `AAAA-MM-DDTHH:mm` en hora local de `zona` al instante UTC correspondiente. */
export function localAUtc(texto: string, zona: string = ZONA_CAFETERIA): Date {
  const m = FORMATO_LOCAL.exec(texto);
  if (!m) throw new FechaInvalida(`Fecha «${texto}» no válida. ${AYUDA_FORMATO}`);
  const [anio, mes, dia, hora, minuto] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const ingenuo = Date.UTC(anio, mes - 1, dia, hora, minuto);
  const comprobacion = new Date(ingenuo);
  if (
    hora > 23 ||
    minuto > 59 ||
    comprobacion.getUTCFullYear() !== anio ||
    comprobacion.getUTCMonth() !== mes - 1 ||
    comprobacion.getUTCDate() !== dia
  ) {
    throw new FechaInvalida(`La fecha «${texto}» no existe en el calendario. ${AYUDA_FORMATO}`);
  }
  // Se corrige con el desfase en el instante resultante, por si cruza un cambio de horario.
  const primero = ingenuo - desfase(ingenuo, zona);
  return new Date(ingenuo - desfase(primero, zona));
}

/** Convierte un instante UTC a `AAAA-MM-DDTHH:mm` en hora local de `zona`. */
export function utcALocal(instante: Date, zona: string = ZONA_CAFETERIA): string {
  const p = partesEnZona(instante.getTime(), zona);
  const dos = (n: number): string => String(n).padStart(2, '0');
  return `${String(p.anio)}-${dos(p.mes)}-${dos(p.dia)}T${dos(p.hora)}:${dos(p.minuto)}`;
}
