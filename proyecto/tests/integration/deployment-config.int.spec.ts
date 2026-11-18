import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { execFile, spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseEnv } from 'node:util';
import { WEB_RUNTIME_CACHE, hashDirectory } from '../../scripts/ci/package-candidate.js';

// T041 — FR-012 en su versión local: lo que se compila una vez se promueve intacto y SOLO la
// configuración de runtime cambia entre entornos. Se compila la web UNA vez, se ejecuta con dos
// APIs distintas y se comprueba que (1) cada ejecución usó su configuración y (2) el hash de lo
// compilado no cambió. No prueba a Vercel: demuestra que el paquete no lleva la URL compilada.
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const web = join(workspace, 'apps/web');
const next = join(web, 'node_modules/next/dist/bin/next');
const build = join(web, '.next');
// Lo que Next escribe al servir (cachés de ejecución) no forma parte del paquete que se promueve.
const EXCLUDE = WEB_RUNTIME_CACHE;

/**
 * Termina el proceso Y a sus hijos. `next start` lanza un proceso hijo y en Windows `kill()` solo
 * mata al padre: el huérfano seguiría vivo, con el puerto y sus conexiones abiertas.
 */
async function killTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const closed = once(child, 'exit');
  if (process.platform === 'win32' && child.pid !== undefined)
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
  await closed;
}

async function listen(version: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ status: 'ok', version }));
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Puerto no disponible');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Puerto no disponible');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

/** Hash de cada archivo de la compilación, para señalar EXACTAMENTE cuál cambió. */
function snapshot(directory: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const file of files(directory))
    result.set(
      file.slice(directory.length),
      createHash('sha256').update(readFileSync(file)).digest('hex'),
    );
  return result;
}

function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((file) => before.get(file) !== after.get(file))
    .sort();
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (EXCLUDE.includes(entry.name)) return [];
    const full = join(directory, entry.name);
    return entry.isDirectory() ? files(full) : statSync(full).isFile() ? [full] : [];
  });
}

describe('una compilación, dos configuraciones de runtime', () => {
  const upstreams: Server[] = [];
  const children: ChildProcess[] = [];

  beforeAll(async () => {
    await promisify(execFile)(process.execPath, [next, 'build', 'apps/web'], {
      cwd: workspace,
      env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
      timeout: 120_000,
    });
  }, 150_000);

  afterAll(async () => {
    for (const child of children) await killTree(child);
    await Promise.all(
      upstreams.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
    );
  });

  /** Arranca la web ya compilada apuntando a un origen de API concreto y consulta su proxy. */
  async function serveWith(apiOrigin: string) {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(
      process.execPath,
      [next, 'start', 'apps/web', '-p', String(port), '-H', '127.0.0.1'],
      {
        cwd: workspace,
        env: {
          ...process.env,
          ...parseEnv(readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')),
          NODE_ENV: 'production',
          API_BASE_URL: apiOrigin,
          WEB_PORT: String(port),
          WEB_ORIGIN: origin,
          NEXT_TELEMETRY_DISABLED: '1',
        },
        stdio: 'ignore',
      },
    );
    children.push(child);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) throw new Error('Next terminó antes de arrancar');
      try {
        if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) break;
      } catch {
        /* esperando el arranque */
      }
      await delay(250);
    }
    const response = await fetch(`${origin}/api/health`);
    const body = await response.json();
    await killTree(child);
    return { status: response.status, body };
  }

  test('cada ejecución usa su configuración y el hash de lo compilado no cambia', async () => {
    const before = hashDirectory(build, { exclude: EXCLUDE });
    const filesBefore = snapshot(build);
    const staging = await listen('version-staging');
    const production = await listen('version-produccion');
    upstreams.push(staging.server, production.server);

    const first = await serveWith(staging.origin);
    const second = await serveWith(production.origin);

    // La misma compilación respondió con la versión de cada API: la configuración es de runtime.
    expect(first).toEqual({ status: 200, body: { status: 'ok', version: 'version-staging' } });
    expect(second).toEqual({ status: 200, body: { status: 'ok', version: 'version-produccion' } });
    // Y el paquete no se modificó al ejecutarlo con ninguna de las dos (archivo por archivo y en conjunto).
    expect(changedFiles(filesBefore, snapshot(build))).toEqual([]);
    expect(hashDirectory(build, { exclude: EXCLUDE })).toBe(before);
  }, 120_000);

  test('la compilación no lleva dentro ningún origen de API ni URL de entorno', () => {
    const forbidden = [/https?:\/\/127\.0\.0\.1:\d{4,5}/, /API_BASE_URL=/, /postgresql:\/\//];
    const offenders = files(build)
      .filter((file) => /\.(js|json|html|txt|map)$/.test(file))
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return forbidden.some((pattern) => pattern.test(text));
      })
      .map((file) => file.slice(build.length));
    expect(offenders).toEqual([]);
  });
});
