import {
  base,
  choice,
  loadEnvironment,
  port,
  required,
  url,
} from '../../../../packages/config/src/env.js';
import type { ConfigInput } from '../../../../packages/config/src/env.js';

export function readApiConfig(input: ConfigInput = {}) {
  const environment = loadEnvironment(input);
  return Object.freeze({
    ...base(environment),
    port: port(environment, 'API_PORT'),
    webOrigin: url(environment, 'WEB_ORIGIN', ['http:', 'https:'], true),
    databaseUrl: url(environment, 'DATABASE_URL', ['postgresql:', 'postgres:']),
    redisUrl: url(environment, 'REDIS_URL', ['redis:', 'rediss:']),
    rabbitmqUrl: url(environment, 'RABBITMQ_URL', ['amqp:', 'amqps:']),
    flagsPrefix: required(environment, 'FEATURE_FLAGS_PREFIX'),
    metricsExportEnabled:
      choice(environment, 'METRICS_EXPORT_ENABLED', ['true', 'false'] as const) === 'true',
  });
}
