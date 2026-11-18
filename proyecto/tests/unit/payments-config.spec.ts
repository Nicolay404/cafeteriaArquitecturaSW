import { describe, expect, it } from 'vitest';
import { readPaymentsConfig } from '../../apps/api/src/modules/pagos/config.js';

describe('readPaymentsConfig', () => {
  it('loads valid payments configuration with defaults', () => {
    const config = readPaymentsConfig({
      envFile: null,
      environment: {
        PAYMENT_GATEWAY_PROVIDER: 'mock',
        PAYMENT_GATEWAY_WEBHOOK_SECRET: 'test_secret',
        MAX_PENDING_CASH_ORDERS: '3',
      },
    });

    expect(config.gatewayProvider).toBe('mock');
    expect(config.webhookSecret).toBe('test_secret');
    expect(config.maxPendingCashOrders).toBe(3);
  });

  it('uses default values when optional fields are omitted', () => {
    const config = readPaymentsConfig({
      envFile: null,
      environment: {
        PAYMENT_GATEWAY_PROVIDER: 'stripe',
      },
    });

    expect(config.gatewayProvider).toBe('stripe');
    expect(config.webhookSecret).toBe('mock_secret');
    expect(config.maxPendingCashOrders).toBe(2);
  });

  it('rejects invalid gateway provider', () => {
    expect(() =>
      readPaymentsConfig({
        envFile: null,
        environment: {
          PAYMENT_GATEWAY_PROVIDER: 'invalid_provider',
        },
      }),
    ).toThrow('PAYMENT_GATEWAY_PROVIDER');
  });

  it('rejects non-integer max pending cash orders', () => {
    expect(() =>
      readPaymentsConfig({
        envFile: null,
        environment: {
          PAYMENT_GATEWAY_PROVIDER: 'mock',
          MAX_PENDING_CASH_ORDERS: 'dos',
        },
      }),
    ).toThrow('MAX_PENDING_CASH_ORDERS');
  });
});
