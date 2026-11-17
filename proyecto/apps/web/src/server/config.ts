import { base, loadEnvironment, port, url } from '../../../../packages/config/src/env.ts';
import type { ConfigInput } from '../../../../packages/config/src/env.ts';

// Server-side only. Do not export upstream configuration through client components.
export function readWebConfig(input: ConfigInput = {}) {
  // Next receives environment from the launcher/platform. Never auto-read or
  // trace a private dotenv file into its build; explicit test files still work.
  const environment = loadEnvironment({ ...input, envFile: input.envFile ?? null });
  return Object.freeze({
    ...base(environment),
    port: port(environment, 'WEB_PORT'),
    apiBaseUrl: url(environment, 'API_BASE_URL', ['http:', 'https:'], true),
    origin: url(environment, 'WEB_ORIGIN', ['http:', 'https:'], true),
  });
}
