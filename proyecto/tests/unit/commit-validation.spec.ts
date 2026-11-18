import lint from '@commitlint/lint';
import load from '@commitlint/load';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// T023/T025 — Constitución VII: Conventional Commits con el módulo como alcance.
// Se usa la configuración real de commitlint del workspace, sin crear ningún commit.
const cwd = fileURLToPath(new URL('../../', import.meta.url));

async function check(message: string) {
  const config = await load({}, { cwd, file: 'commitlint.config.cjs' });
  const report = await lint(message, config.rules, {
    parserOpts: (config.parserPreset?.parserOpts ?? {}) as NonNullable<
      Parameters<typeof lint>[2]
    >['parserOpts'] & {},
  });
  return {
    valid: report.valid,
    errors: report.errors.map((item) => item.name),
  };
}

describe('mensajes de commit', () => {
  it.each([
    'feat(pedidos): crear pedidos con clave de idempotencia',
    'fix(infra): desactivar DNS inverso de Mailpit en local',
    'test(plataforma): verificar los límites entre módulos con el lint real',
    'docs(specs): añadir el plan del Spec #2',
    'chore(deps): actualizar vitest',
    'refactor(catalogo): extraer la validación de disponibilidad',
    'feat(pagos)!: exigir token de pasarela\n\nBREAKING CHANGE: el campo tarjeta ya no se acepta.',
  ])('acepta «%s»', async (message) => {
    expect(await check(message)).toEqual({ valid: true, errors: [] });
  });

  it('rechaza un tipo que no es Conventional Commits', async () => {
    const result = await check('arreglo(pedidos): corregir el total');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('type-enum');
  });

  it('exige el módulo como alcance', async () => {
    const result = await check('feat: añadir carrito');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('scope-empty');
  });

  it('rechaza un alcance que no es un módulo ni un área conocida', async () => {
    const result = await check('feat(cualquiercosa): añadir carrito');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('scope-enum');
  });

  it('rechaza una descripción vacía o con punto final', async () => {
    expect((await check('feat(pedidos): ')).valid).toBe(false);
    const dotted = await check('feat(pedidos): crear pedido.');
    expect(dotted.valid).toBe(false);
    expect(dotted.errors).toContain('subject-full-stop');
  });

  it('rechaza una cabecera de más de 100 caracteres', async () => {
    const result = await check(`feat(pedidos): ${'a'.repeat(100)}`);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('header-max-length');
  });

  it('rechaza un tipo en mayúsculas o un mensaje sin forma de Conventional Commit', async () => {
    expect((await check('Feat(pedidos): crear pedido')).valid).toBe(false);
    expect((await check('arreglos varios')).valid).toBe(false);
  });
});
