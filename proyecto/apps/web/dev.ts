import next from 'next';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readWebConfig } from './src/server/config.ts';

const config = readWebConfig();
const app = next({
  dev: true,
  dir: fileURLToPath(new URL('./', import.meta.url)),
  hostname: '127.0.0.1',
  port: config.port,
});
await app.prepare();
const server = createServer(app.getRequestHandler());
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(config.port, '127.0.0.1', resolve);
});
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    })().catch(() => {
      console.error('No se pudo cerrar la web local');
      process.exitCode = 1;
    });
  });
}
