import 'reflect-metadata';
import { readApiConfig } from './platform/config.js';
import { ConfigurationError } from '../../../packages/config/src/env.js';
import { createApp } from './composition/app.js';

async function main() {
  const config = readApiConfig();
  const { app } = await createApp(config);
  await app.listen(config.port, '0.0.0.0');
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigurationError ? error.message : 'No se pudo iniciar la API');
  process.exitCode = 1;
});
