// Repositorio de promociones sobre el esquema propio `promotions` (T008; migración 040).
// Es también la FuentePromociones del cotizador: devuelve las activas cuya ventana no ha
// terminado. Bloqueo optimista por `version` (R9): dos administradores no se pisan.

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FuentePromociones } from '../aplicacion/cotizador.service.js';
import { siguienteEstado, type AccionEstado, type DatosPromocion } from '../dominio/promocion.js';
import type { Alcance, EstadoPromocion, Promocion, ValorPromocion } from '../dominio/tipos.js';

export class PromocionNoEncontrada extends Error {
  constructor(id: string) {
    super(`No existe la promoción «${id}».`);
    this.name = 'PromocionNoEncontrada';
  }
}

export class ConflictoVersion extends Error {
  constructor() {
    super('Otra persona cambió esta promoción. Recárguela, revise los cambios y vuelva a guardar.');
    this.name = 'ConflictoVersion';
  }
}

export class PromocionArchivada extends Error {
  constructor() {
    super('Una promoción archivada no se puede editar; cree una nueva.');
    this.name = 'PromocionArchivada';
  }
}

export class CuponDuplicado extends Error {
  constructor(codigo: string) {
    super(`El código de cupón «${codigo}» ya lo usa otra promoción; elija otro.`);
    this.name = 'CuponDuplicado';
  }
}

interface Fila {
  id: string;
  nombre: string;
  valor: ValorPromocion;
  alcance: Alcance;
  inicio: Date;
  fin: Date;
  etiqueta_festividad: string | null;
  prioridad: number;
  acumulable: boolean;
  monto_minimo_centavos: string | null;
  cupon_codigo: string | null;
  cupon_limite_usos: number | null;
  usos: number;
  estado: EstadoPromocion;
  version: number;
}

const COLUMNAS = `id, nombre, valor, alcance, inicio, fin, etiqueta_festividad, prioridad, acumulable,
  monto_minimo_centavos, cupon_codigo, cupon_limite_usos, usos, estado, version`;

function aPromocion(f: Fila): Promocion {
  const cupon =
    f.cupon_codigo === null
      ? undefined
      : f.cupon_limite_usos === null
        ? { codigo: f.cupon_codigo }
        : { codigo: f.cupon_codigo, limiteUsos: f.cupon_limite_usos };
  return {
    id: f.id,
    nombre: f.nombre,
    valor: f.valor,
    alcance: f.alcance,
    inicio: f.inicio,
    fin: f.fin,
    prioridad: f.prioridad,
    acumulable: f.acumulable,
    usos: f.usos,
    estado: f.estado,
    version: f.version,
    ...(f.etiqueta_festividad === null ? {} : { etiquetaFestividad: f.etiqueta_festividad }),
    ...(f.monto_minimo_centavos === null
      ? {}
      : { montoMinimoCentavos: Number(f.monto_minimo_centavos) }),
    ...(cupon ? { cupon } : {}),
  };
}

/** Parámetros $3..$13 comunes a crear y actualizar. */
function parametros(d: DatosPromocion): unknown[] {
  return [
    d.nombre,
    d.valor.tipo,
    JSON.stringify(d.valor),
    JSON.stringify(d.alcance),
    d.inicio,
    d.fin,
    d.etiquetaFestividad ?? null,
    d.prioridad,
    d.acumulable,
    d.montoMinimoCentavos ?? null,
    d.cupon?.codigo ?? null,
    d.cupon?.limiteUsos ?? null,
  ];
}

function esCuponDuplicado(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string };
  return e.code === '23505' && e.constraint === 'promotions_cupon_unico';
}

export class RepositorioPromociones implements FuentePromociones {
  constructor(
    private readonly pool: Pool,
    private readonly generarId: () => string = randomUUID,
  ) {}

  async crear(datos: DatosPromocion, actorId: string): Promise<Promocion> {
    try {
      const { rows } = await this.pool.query<Fila>(
        `INSERT INTO promotions.promotions (id, creada_por, nombre, tipo, valor, alcance, inicio, fin,
           etiqueta_festividad, prioridad, acumulable, monto_minimo_centavos, cupon_codigo,
           cupon_limite_usos, actualizada_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $2)
         RETURNING ${COLUMNAS}`,
        [this.generarId(), actorId, ...parametros(datos)],
      );
      return aPromocion(rows[0] as Fila);
    } catch (error) {
      if (esCuponDuplicado(error)) throw new CuponDuplicado(datos.cupon?.codigo ?? '');
      throw error;
    }
  }

  async obtener(id: string): Promise<Promocion | undefined> {
    const { rows } = await this.pool.query<Fila>(
      `SELECT ${COLUMNAS} FROM promotions.promotions WHERE id = $1`,
      [id],
    );
    return rows[0] ? aPromocion(rows[0]) : undefined;
  }

  async listar(
    filtro: { estado?: EstadoPromocion; etiquetaFestividad?: string } = {},
  ): Promise<Promocion[]> {
    const { rows } = await this.pool.query<Fila>(
      `SELECT ${COLUMNAS} FROM promotions.promotions
       WHERE ($1::text IS NULL OR estado = $1) AND ($2::text IS NULL OR etiqueta_festividad = $2)
       ORDER BY creada_en, id`,
      [filtro.estado ?? null, filtro.etiquetaFestividad ?? null],
    );
    return rows.map(aPromocion);
  }

  async candidatas(instante: Date): Promise<readonly Promocion[]> {
    const { rows } = await this.pool.query<Fila>(
      `SELECT ${COLUMNAS} FROM promotions.promotions
       WHERE estado = 'activa' AND fin > $1 ORDER BY id`,
      [instante],
    );
    return rows.map(aPromocion);
  }

  async actualizar(
    id: string,
    versionEsperada: number,
    datos: DatosPromocion,
    actorId: string,
  ): Promise<Promocion> {
    let rows: Fila[];
    try {
      ({ rows } = await this.pool.query<Fila>(
        `UPDATE promotions.promotions SET
           nombre = $3, tipo = $4, valor = $5, alcance = $6, inicio = $7, fin = $8,
           etiqueta_festividad = $9, prioridad = $10, acumulable = $11, monto_minimo_centavos = $12,
           cupon_codigo = $13, cupon_limite_usos = $14,
           version = version + 1, actualizada_por = $15, actualizada_en = now()
         WHERE id = $1 AND version = $2 AND estado <> 'archivada'
         RETURNING ${COLUMNAS}`,
        [id, versionEsperada, ...parametros(datos), actorId],
      ));
    } catch (error) {
      if (esCuponDuplicado(error)) throw new CuponDuplicado(datos.cupon?.codigo ?? '');
      throw error;
    }
    if (rows[0]) return aPromocion(rows[0]);
    const actual = await this.obtener(id);
    if (!actual) throw new PromocionNoEncontrada(id);
    if (actual.estado === 'archivada') throw new PromocionArchivada();
    throw new ConflictoVersion();
  }

  async cambiarEstado(
    id: string,
    versionEsperada: number,
    accion: AccionEstado,
    actorId: string,
  ): Promise<Promocion> {
    const actual = await this.obtener(id);
    if (!actual) throw new PromocionNoEncontrada(id);
    if (actual.version !== versionEsperada) throw new ConflictoVersion();
    const estado = siguienteEstado(actual.estado, accion);
    const { rows } = await this.pool.query<Fila>(
      `UPDATE promotions.promotions
       SET estado = $3, version = version + 1, actualizada_por = $4, actualizada_en = now()
       WHERE id = $1 AND version = $2
       RETURNING ${COLUMNAS}`,
      [id, versionEsperada, estado, actorId],
    );
    if (!rows[0]) throw new ConflictoVersion();
    return aPromocion(rows[0]);
  }
}
