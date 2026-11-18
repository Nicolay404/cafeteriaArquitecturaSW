import {
  base,
  choice,
  loadEnvironment,
  port,
  required,
  secret,
  url,
} from '../../../../packages/config/src/env.js';
import type { ConfigInput } from '../../../../packages/config/src/env.js';

export function readApiConfig(input: ConfigInput = {}) {
  const environment = loadEnvironment(input);
  const common = base(environment);
  return Object.freeze({
    ...common,
    port: port(environment, 'API_PORT'),
    webOrigin: url(environment, 'WEB_ORIGIN', ['http:', 'https:'], true),
    databaseUrl: url(environment, 'DATABASE_URL', ['postgresql:', 'postgres:']),
    redisUrl: url(environment, 'REDIS_URL', ['redis:', 'rediss:']),
    rabbitmqUrl: url(environment, 'RABBITMQ_URL', ['amqp:', 'amqps:']),
    flagsPrefix: required(environment, 'FEATURE_FLAGS_PREFIX'),
    metricsExportEnabled:
      choice(environment, 'METRICS_EXPORT_ENABLED', ['true', 'false'] as const) === 'true',
    smtpHost: required(environment, 'SMTP_HOST'),
    smtpPort: port(environment, 'SMTP_PORT'),
    piiKeys: { 1: secret(environment, 'PII_KEY_1', common.appEnv) },
    piiIndexKey: secret(environment, 'PII_INDEX_KEY', common.appEnv),
    sessionSecret: secret(environment, 'SESSION_SECRET', common.appEnv),
    hibpEnabled: choice(environment, 'HIBP_ENABLED', ['true', 'false'] as const) === 'true',
  });
}
