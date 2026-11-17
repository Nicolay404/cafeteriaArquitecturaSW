import { base, loadEnvironment, port, url } from '../../../../packages/config/src/env.js';
import type { ConfigInput } from '../../../../packages/config/src/env.js';

// Server-side only. Do not export upstream configuration through client components.
export function readWebConfig(input: ConfigInput = {}) {
  const environment = loadEnvironment(input);
  return Object.freeze({
    ...base(environment),
    port: port(environment, 'WEB_PORT'),
    apiBaseUrl: url(environment, 'API_BASE_URL', ['http:', 'https:'], true),
    origin: url(environment, 'WEB_ORIGIN', ['http:', 'https:'], true),
  });
}
