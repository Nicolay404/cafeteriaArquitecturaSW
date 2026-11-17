import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { parseEnv, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { within } from './probes.fixture.js';

describe('T013–T014 — Next compilado y proxy runtime', () => {
  let status = 200;
  let child: ChildProcess | undefined;
  let baseUrl = '';
  const paths: string[] = [];
  const upstream = createServer((request, response) => {
    paths.push(request.url!);
    if (status === 302) {
      response.writeHead(302, { Location: '/private' }).end();
      return;
    }
    response.writeHead(status, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        status: status === 200 ? 'ok' : 'unavailable',
        version: 'upstream-runtime-version',
        secret: 'not-public',
      }),
    );
  });

  beforeAll(async () => {
    const cwd = fileURLToPath(new URL('../../', import.meta.url));
    const next = fileURLToPath(
      new URL('../../apps/web/node_modules/next/dist/bin/next', import.meta.url),
    );
    await promisify(execFile)(process.execPath, [next, 'build', 'apps/web'], {
      cwd,
      env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
      timeout: 60_000,
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('Puerto upstream no disponible');
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const webAddress = reservation.address();
    if (!webAddress || typeof webAddress === 'string') throw new Error('Puerto web no disponible');
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    baseUrl = `http://127.0.0.1:${webAddress.port}`;
    child = spawn(
      process.execPath,
      [next, 'start', 'apps/web', '-p', String(webAddress.port), '-H', '127.0.0.1'],
      {
        cwd,
        env: {
          ...process.env,
          ...parseEnv(readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')),
          NODE_ENV: 'production',
          API_BASE_URL: `http://127.0.0.1:${address.port}`,
          WEB_PORT: String(webAddress.port),
          WEB_ORIGIN: baseUrl,
          NEXT_TELEMETRY_DISABLED: '1',
        },
        stdio: 'ignore',
      },
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Next terminó antes del arranque');
      try {
        if ((await fetch(baseUrl, { signal: AbortSignal.timeout(1000) })).ok) return;
      } catch {
        /* wait */
      }
      await delay(100);
    }
    throw new Error('Next no inició');
  });

  afterAll(async () => {
    try {
      if (child && child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await within(exited, 10_000);
      }
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  test('inicio 200 con idioma y contenido honesto', async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('lang="es"');
    expect(html).toContain('<h1>Cafetería</h1>');
    expect(html).toContain('todavía no están disponibles');
    expect(html).not.toContain('not-public');
  });

  test.each([200, 503])('proxy preserva %s/versión/no-store después del build', async (code) => {
    status = code;
    const response = await fetch(`${baseUrl}/api/health?url=http://untrusted.invalid`);
    expect(response.status).toBe(code);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: code === 200 ? 'ok' : 'unavailable',
      version: 'upstream-runtime-version',
    });
    expect(paths.at(-1)).toBe('/health');
  });

  test('no sigue redirecciones upstream', async () => {
    status = 302;
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(503);
    expect(paths).not.toContain('/private');
  });
});
