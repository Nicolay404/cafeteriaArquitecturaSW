import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Home from './page.js';
import Layout, { metadata } from './layout.js';

describe('T013 — base funcional sin diseño final', () => {
  it('ofrece español, título, h1, landmark y enlace de salto a contenido enfocable', () => {
    const html = renderToStaticMarkup(
      <Layout>
        <Home />
      </Layout>,
    );
    expect(html).toContain('lang="es"');
    expect(metadata.title).toBe('Cafetería');
    expect(html).toContain('href="#contenido"');
    expect(html).toContain('<main id="contenido" tabindex="-1"');
    expect(html).toContain('<h1>Cafetería</h1>');
    expect(html).toContain('todavía no están disponibles');
    expect(html).not.toMatch(/<form|<button|<img|href="\/(menu|login|carrito)/);
  });
});
