import { readApiConfig } from '../apps/api/src/platform/config.js';
import { readWorkerConfig } from '../apps/worker/src/config.js';
import { readWebConfig } from '../apps/web/src/server/config.js';
import { ConfigurationError, loadEnvironment } from '../packages/config/src/env.js';
import { cliEnvironment } from './local-environment.js';

try {
  const environment = process.argv.length > 2 ? cliEnvironment() : loadEnvironment();
  const input = { environment, envFile: null };
  readApiConfig(input);
  readWorkerConfig(input);
  readWebConfig(input);
  console.log('Configuración válida: API, worker y web.');
} catch (error) {
  console.error(
    error instanceof ConfigurationError ? error.message : 'No se pudo validar el entorno.',
  );
  process.exitCode = 1;
}
