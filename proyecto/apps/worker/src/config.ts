import {
  base,
  choice,
  loadEnvironment,
  port,
  required,
  url,
} from '../../../packages/config/src/env.js';
import type { ConfigInput } from '../../../packages/config/src/env.js';

export function readWorkerConfig(input: ConfigInput = {}) {
  const environment = loadEnvironment(input);
  return Object.freeze({
    ...base(environment),
    databaseUrl: url(environment, 'DATABASE_URL', ['postgresql:', 'postgres:']),
    redisUrl: url(environment, 'REDIS_URL', ['redis:', 'rediss:']),
    rabbitmqUrl: url(environment, 'RABBITMQ_URL', ['amqp:', 'amqps:']),
    smtpHost: required(environment, 'SMTP_HOST'),
    smtpPort: port(environment, 'SMTP_PORT'),
    flagsPrefix: required(environment, 'FEATURE_FLAGS_PREFIX'),
    metricsExportEnabled:
      choice(environment, 'METRICS_EXPORT_ENABLED', ['true', 'false'] as const) === 'true',
  });
}
