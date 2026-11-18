import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
