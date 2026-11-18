import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { Pool } from 'pg';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import { MIGRATIONS_DIR, migrate } from '../../scripts/db/migrate.js';
import {
  ConflictoVersion,
  CuponDuplicado,
  PromocionArchivada,
  PromocionNoEncontrada,
  RepositorioPromociones,
} from '../../apps/api/src/modules/promociones/infraestructura/promociones.repository.js';
import { CotizadorPromociones } from '../../apps/api/src/modules/promociones/aplicacion/cotizador.service.js';
import {
  TransicionNoPermitida,
  type DatosPromocion,
} from '../../apps/api/src/modules/promociones/dominio/promocion.js';

// T007 + T008 — esquema promotions y repositorio con Postgres real.
const ADMIN = 'admin-1';
const AHORA = new Date('2026-12-23T15:00:00.000Z');

const base: DatosPromocion = {
  nombre: '20 % en bebidas calientes',
  valor: { tipo: 'porcentaje', puntosBasicos: 2000 },
  alcance: { productoIds: [], categoriaIds: ['calientes'], menuIds: [] },
  inicio: new Date('2026-12-20T05:00:00.000Z'),
  fin: new Date('2026-12-26T05:00:00.000Z'),
  prioridad: 0,
  acumulable: false,
};

describe('T007/T008 — repositorio de promociones con Postgres real', () => {
  let infrastructure: Infrastructure;
  let pool: Pool;
  let repo: RepositorioPromociones;

  beforeAll(async () => {
    infrastructure = await startInfrastructure();
    const resultado = await migrate({
      databaseUrl: infrastructure.databaseUrl,
      directory: MIGRATIONS_DIR,
    });
    expect(resultado.applied).toContain('040');
    pool = new Pool({ connectionString: infrastructure.databaseUrl, max: 4 });
    repo = new RepositorioPromociones(pool);
  });
  beforeEach(async () => {
    // TRUNCATE no dispara el trigger de filas que protege la auditoría.
    await pool.query('TRUNCATE promotions.promotions CASCADE');
  });
  afterAll(async () => {
    try {
      await pool?.end();
    } finally {
      await infrastructure?.stop();
    }
  });

  test('la migración 040 es idempotente con el runner del proyecto', async () => {
    const otra = await migrate({
      databaseUrl: infrastructure.databaseUrl,
      directory: MIGRATIONS_DIR,
    });
    expect(otra.applied).toEqual([]);
    expect(otra.alreadyApplied).toContain('040');
  });

  test('crear y obtener conserva todos los campos', async () => {
    const completa: DatosPromocion = {
      ...base,
      nombre: 'Combo Navidad',
      valor: {
        tipo: 'combo',
        productos: [
          { productoId: 'cafe', cantidad: 1 },
          { productoId: 'sanduche', cantidad: 1 },
        ],
        precioCentavos: 500,
      },
      alcance: { productoIds: [], categoriaIds: [], menuIds: [] },
      etiquetaFestividad: 'Navidad',
      prioridad: 7,
      acumulable: true,
      montoMinimoCentavos: 1500,
      cupon: { codigo: 'NAVIDAD', limiteUsos: 100 },
    };
    const creada = await repo.crear(completa, ADMIN);
    expect(creada).toEqual({ ...completa, id: creada.id, usos: 0, estado: 'activa', version: 1 });
    expect(await repo.obtener(creada.id)).toEqual(creada);
  });

  test('omite los campos opcionales vacíos y devuelve undefined si no existe', async () => {
    const creada = await repo.crear(base, ADMIN);
    expect(Object.keys(creada).sort()).toEqual(
      [
        'acumulable',
        'alcance',
        'estado',
        'fin',
        'id',
        'inicio',
        'nombre',
        'prioridad',
        'usos',
        'valor',
        'version',
      ].sort(),
    );
    expect(await repo.obtener('00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });

  test('candidatas: activas cuya ventana no ha terminado (vigentes y futuras)', async () => {
    const vigente = await repo.crear(base, ADMIN);
    const futura = await repo.crear(
      {
        ...base,
        nombre: 'Año nuevo',
        inicio: new Date('2026-12-31T05:00:00Z'),
        fin: new Date('2027-01-02T05:00:00Z'),
      },
      ADMIN,
    );
    await repo.crear(
      { ...base, nombre: 'Terminada', inicio: new Date('2026-12-01T05:00:00Z'), fin: AHORA },
      ADMIN,
    );
    const pausada = await repo.crear({ ...base, nombre: 'Pausada' }, ADMIN);
    await repo.cambiarEstado(pausada.id, 1, 'pausar', ADMIN);

    const ids = (await repo.candidatas(AHORA)).map((p) => p.id).sort();
    expect(ids).toEqual([vigente.id, futura.id].sort());
  });

  test('actualizar exige la versión vigente', async () => {
    const creada = await repo.crear(base, ADMIN);
    const editada = await repo.actualizar(
      creada.id,
      1,
      { ...base, nombre: '25 % en calientes' },
      ADMIN,
    );
    expect(editada).toMatchObject({ nombre: '25 % en calientes', version: 2 });
    await expect(repo.actualizar(creada.id, 1, base, ADMIN)).rejects.toThrow(ConflictoVersion);
    await expect(
      repo.actualizar('00000000-0000-4000-8000-000000000000', 1, base, ADMIN),
    ).rejects.toThrow(PromocionNoEncontrada);
  });

  test('dos administradores editan a la vez: solo uno gana (R9)', async () => {
    const creada = await repo.crear(base, ADMIN);
    const resultados = await Promise.allSettled([
      repo.actualizar(creada.id, 1, { ...base, nombre: 'Versión de Ana' }, 'admin-a'),
      repo.actualizar(creada.id, 1, { ...base, nombre: 'Versión de Luis' }, 'admin-b'),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === 'rejected');
    expect(rechazo?.status === 'rejected' && rechazo.reason).toBeInstanceOf(ConflictoVersion);
    expect((await repo.obtener(creada.id))?.version).toBe(2);
  });

  test('transiciones de estado; archivada es final y no se edita', async () => {
    const creada = await repo.crear(base, ADMIN);
    const pausada = await repo.cambiarEstado(creada.id, 1, 'pausar', ADMIN);
    expect(pausada).toMatchObject({ estado: 'pausada', version: 2 });
    await expect(repo.cambiarEstado(creada.id, 2, 'pausar', ADMIN)).rejects.toThrow(
      TransicionNoPermitida,
    );
    const reanudada = await repo.cambiarEstado(creada.id, 2, 'reanudar', ADMIN);
    expect(reanudada.estado).toBe('activa');
    await expect(repo.cambiarEstado(creada.id, 2, 'archivar', ADMIN)).rejects.toThrow(
      ConflictoVersion,
    );
    await repo.cambiarEstado(creada.id, 3, 'archivar', ADMIN);
    await expect(repo.actualizar(creada.id, 4, base, ADMIN)).rejects.toThrow(PromocionArchivada);
  });

  test('un código de cupón no se repite entre promociones no archivadas', async () => {
    const primera = await repo.crear({ ...base, cupon: { codigo: 'NAVIDAD' } }, ADMIN);
    await expect(repo.crear({ ...base, cupon: { codigo: 'NAVIDAD' } }, ADMIN)).rejects.toThrow(
      CuponDuplicado,
    );
    await repo.cambiarEstado(primera.id, 1, 'archivar', ADMIN);
    await expect(
      repo.crear({ ...base, cupon: { codigo: 'NAVIDAD' } }, ADMIN),
    ).resolves.toBeDefined();
  });

  test('la base de datos rechaza ventanas inválidas aunque falle la validación de la app', async () => {
    await expect(
      pool.query(
        `INSERT INTO promotions.promotions (id, nombre, tipo, valor, alcance, inicio, fin, creada_por, actualizada_por)
         VALUES (gen_random_uuid(), 'Mal', 'porcentaje', '{}', '{}', now(), now() - interval '1 day', 'x', 'x')`,
      ),
    ).rejects.toThrow(/promotions_ventana/);
  });

  test('listar filtra por estado y etiqueta', async () => {
    await repo.crear({ ...base, etiquetaFestividad: 'Navidad' }, ADMIN);
    const madre = await repo.crear(
      { ...base, nombre: 'Día de la Madre', etiquetaFestividad: 'Madre' },
      ADMIN,
    );
    await repo.cambiarEstado(madre.id, 1, 'pausar', ADMIN);
    expect((await repo.listar({ estado: 'pausada' })).map((p) => p.nombre)).toEqual([
      'Día de la Madre',
    ]);
    expect((await repo.listar({ etiquetaFestividad: 'Navidad' })).map((p) => p.nombre)).toEqual([
      '20 % en bebidas calientes',
    ]);
    expect(await repo.listar()).toHaveLength(2);
  });

  test('cotizar de punta a punta con el repositorio real', async () => {
    await repo.crear(base, ADMIN);
    const cotizador = new CotizadorPromociones(repo, {
      limitador: {
        estaBloqueado: () => Promise.resolve(false),
        registrarFallo: () => Promise.resolve(),
      },
      reloj: () => AHORA,
    });
    const c = await cotizador.cotizar({
      lineas: [
        {
          productoId: 'cafe',
          categoriaIds: ['calientes'],
          menuId: 'desayuno',
          cantidad: 2,
          precioBaseCentavos: 250,
        },
      ],
    });
    expect(c).toMatchObject({ subtotalCentavos: 500, descuentoCentavos: 100, totalCentavos: 400 });
  });
});
