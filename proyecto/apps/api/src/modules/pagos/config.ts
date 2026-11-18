import {
  choice,
  integer,
  loadEnvironment,
  optional,
} from '../../../../../packages/config/src/env.js';
import type { ConfigInput } from '../../../../../packages/config/src/env.js';

export interface PaymentsConfig {
  readonly gatewayProvider: 'mock' | 'stripe' | 'payphone';
  readonly webhookSecret: string;
  readonly maxPendingCashOrders: number;
}

export function readPaymentsConfig(input: ConfigInput = {}): PaymentsConfig {
  const environment = loadEnvironment(input);
  return Object.freeze({
    gatewayProvider: choice(environment, 'PAYMENT_GATEWAY_PROVIDER', [
      'mock',
      'stripe',
      'payphone',
    ] as const),
    webhookSecret: optional(environment, 'PAYMENT_GATEWAY_WEBHOOK_SECRET', 'mock_secret'),
    maxPendingCashOrders: integer(environment, 'MAX_PENDING_CASH_ORDERS', 2),
  });
}
