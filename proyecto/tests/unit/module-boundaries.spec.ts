import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PedidosEnMemoria } from '../fixtures/pedidos-por-cliente.js';

// T019 — Constitución V: ningún módulo importa la implementación de otro; solo su index.ts.
// Se ejecuta el ESLint real del workspace (no una copia de la regla) sobre código en memoria
// ubicado en rutas reales, de modo que la resolución de imports es la del proyecto.
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const eslint = new ESLint({ cwd });

async function violations(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: `${cwd}${filePath}` });
  return result!.messages
    .filter((message) => message.ruleId === 'boundaries/dependencies')
    .map((message) => message.message);
}

const pedidos = 'apps/api/src/modules/pedidos/ilegal.ts';

describe('límites entre módulos de dominio', () => {
  it('rechaza importar la implementación interna de otro módulo', async () => {
    const found = await violations(
      pedidos,
      "import { CatalogoModule } from '../catalogo/catalogo.module.js';\nexport const x = CatalogoModule;\n",
    );
    expect(found).not.toEqual([]);
  });

  it('acepta importar otro módulo por su index.ts público', async () => {
    const found = await violations(
      pedidos,
      "import { CatalogoModule } from '../catalogo/index.js';\nexport const x = CatalogoModule;\n",
    );
    expect(found).toEqual([]);
  });

  it('acepta los imports internos del propio módulo', async () => {
    const found = await violations(
      pedidos,
      "import { PedidosModule } from './pedidos.module.js';\nexport const x = PedidosModule;\n",
    );
    expect(found).toEqual([]);
  });

  it('rechaza que un dominio dependa de la implementación técnica de platform', async () => {
    const found = await violations(
      pedidos,
      "import { HealthService } from '../../platform/health.service.js';\nexport const x = HealthService;\n",
    );
    expect(found).not.toEqual([]);
  });

  it('rechaza que platform importe la implementación interna de un dominio', async () => {
    const found = await violations(
      'apps/api/src/platform/ilegal.ts',
      "import { PedidosModule } from '../modules/pedidos/pedidos.module.js';\nexport const x = PedidosModule;\n",
    );
    expect(found).not.toEqual([]);
  });

  it('Identidad no puede importar la implementación interna de Clientes (T014)', async () => {
    const identidad = 'apps/api/src/modules/identidad/ilegal.ts';
    expect(
      await violations(
        identidad,
        "import { PiiCipher } from '../clientes/pii-cipher.js';\nexport const x = PiiCipher;\n",
      ),
    ).not.toEqual([]);
    expect(
      await violations(
        identidad,
        "import type { ContactoDeCuenta } from '../clientes/index.js';\nexport type X = ContactoDeCuenta;\n",
      ),
    ).toEqual([]);
  });

  it('el doble de PedidosPorCliente ordena por fecha y detecta pedidos en curso (T014)', async () => {
    const pedidos = new PedidosEnMemoria();
    const base = { totalCentavos: 450 };
    pedidos.agregar('p1', { ...base, id: 'a', fecha: '2026-11-01T10:00:00Z', estado: 'entregado' });
    pedidos.agregar('p1', { ...base, id: 'b', fecha: '2026-11-10T10:00:00Z', estado: 'entregado' });
    expect((await pedidos.listar('p1')).map((pedido) => pedido.id)).toEqual(['b', 'a']);
    expect(await pedidos.hayEnCurso('p1')).toBe(false);
    pedidos.agregar('p1', {
      ...base,
      id: 'c',
      fecha: '2026-11-12T10:00:00Z',
      estado: 'en_preparacion',
    });
    expect(await pedidos.hayEnCurso('p1')).toBe(true);
    expect(await pedidos.listar('otro')).toEqual([]);
  });

  it('el código real del repositorio no tiene violaciones de límites', async () => {
    const results = await eslint.lintFiles(['apps/api/src/**/*.ts']);
    const real = results.flatMap((result) =>
      result.messages
        .filter((message) => message.ruleId === 'boundaries/dependencies')
        .map((message) => `${result.filePath}: ${message.message}`),
    );
    expect(real).toEqual([]);
  });
});
