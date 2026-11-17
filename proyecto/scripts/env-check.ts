import { readApiConfig } from '../apps/api/src/platform/config.js';
import { readWorkerConfig } from '../apps/worker/src/config.js';
import { readWebConfig } from '../apps/web/src/server/config.js';
import { ConfigurationError } from '../packages/config/src/env.js';

try {
  readApiConfig();
  readWorkerConfig();
  readWebConfig();
  console.log('Configuración válida: API, worker y web.');
} catch (error) {
  console.error(
    error instanceof ConfigurationError ? error.message : 'No se pudo validar el entorno.',
  );
  process.exitCode = 1;
}
