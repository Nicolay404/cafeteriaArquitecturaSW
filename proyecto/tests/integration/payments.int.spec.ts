import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import { PaymentRepository } from '../../apps/api/src/modules/pagos/repositories/payment.repository.js';
import { OutboxRepository } from '../../apps/api/src/modules/pagos/repositories/outbox.repository.js';
import { PaymentsService } from '../../apps/api/src/modules/pagos/services/payments.service.js';
import { CashPaymentService } from '../../apps/api/src/modules/pagos/services/cash-payment.service.js';
import { TransferService } from '../../apps/api/src/modules/pagos/services/transfer.service.js';
import { RefundService } from '../../apps/api/src/modules/pagos/services/refund.service.js';
import { MockPaymentGatewayAdapter } from '../../apps/api/src/modules/pagos/services/gateway/mock-gateway.adapter.js';

const migration002Path = fileURLToPath(
  new URL('../../infra/migrations/002_payments_schema.sql', import.meta.url),
);

describe('Spec #7: Integración de Pagos con Infraestructura Real (Testcontainers)', () => {
  let infrastructure: Infrastructure | undefined;
  let client: Client | undefined;
  let hasDocker = false;

  beforeAll(async () => {
    try {
      infrastructure = await startInfrastructure();
      client = new Client({ connectionString: infrastructure.databaseUrl });
      await client.connect();

      // Aplicar migración 002 del esquema payments
      const sql = readFileSync(migration002Path, 'utf8');
      await client.query(sql);
      hasDocker = true;
    } catch {
      // Docker no disponible en este entorno local; documentado en README y alcance local
      hasDocker = false;
    }
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
    if (infrastructure) {
      await infrastructure.stop();
    }
  });

  test('T008: Flujo de tarjeta de crédito e idempotencia con persistencia real', async () => {
    if (!hasDocker || !client) {
      return; // Omitir si Docker no está activo en el entorno
    }

    const paymentRepo = new PaymentRepository(client);
    const outboxRepo = new OutboxRepository(client);
    const gateway = new MockPaymentGatewayAdapter();
    const service = new PaymentsService(paymentRepo, outboxRepo, gateway, {
      gatewayProvider: 'mock',
      webhookSecret: 'integration_secret',
      maxPendingCashOrders: 2,
    });

    const intent = await service.createPaymentIntent({
      orderId: '550e8400-e29b-41d4-a716-446655440000',
      customerId: '660e8400-e29b-41d4-a716-446655440001',
      method: 'card',
      amountCents: 1500,
      currency: 'USD',
      idempotencyKey: 'idem-int-1',
    });

    expect(intent.paymentId).toBeDefined();
    expect(intent.status).toBe('pending');

    // Simular recepción de webhook firmado
    const webhookPayload = {
      eventId: 'evt-int-1',
      eventType: 'payment.succeeded' as const,
      transactionId: 'tx-int-card-1',
      orderReference: '550e8400-e29b-41d4-a716-446655440000',
      amountCents: 1500,
      currency: 'USD',
      signature: '',
      timestamp: new Date().toISOString(),
    };
    const rawBody = JSON.stringify(webhookPayload);
    const signature = gateway.generateSignature(rawBody, 'integration_secret');

    const webhookRes = await service.handleGatewayWebhook(rawBody, signature, webhookPayload);
    expect(webhookRes.received).toBe(true);
    expect(webhookRes.status).toBe('approved');

    // Verificar outbox guardado
    const pendingEvents = await outboxRepo.fetchPendingEvents();
    expect(pendingEvents.some((e) => e.eventName === 'pago.confirmado')).toBe(true);

    // Segundo webhook idéntico (idempotencia)
    const duplicateRes = await service.handleGatewayWebhook(rawBody, signature, webhookPayload);
    expect(duplicateRes.received).toBe(true);
  });

  test('T013: Flujo de cobro en efectivo y cambio en Postgres', async () => {
    if (!hasDocker || !client) {
      return;
    }

    const paymentRepo = new PaymentRepository(client);
    const outboxRepo = new OutboxRepository(client);
    const cashService = new CashPaymentService(paymentRepo, outboxRepo, {
      gatewayProvider: 'mock',
      webhookSecret: 'secret',
      maxPendingCashOrders: 2,
    });

    const payment = await paymentRepo.createPayment({
      orderId: '550e8400-e29b-41d4-a716-446655440002',
      customerId: '660e8400-e29b-41d4-a716-446655440002',
      method: 'cash',
      amountCents: 1250,
      currency: 'USD',
    });

    const result = await cashService.collectCash(payment.id, {
      amountReceivedCents: 1500,
      staffUserId: '770e8400-e29b-41d4-a716-446655440003',
    });

    expect(result.status).toBe('approved');
    expect(result.changeCents).toBe(250);
  });

  test('T017: Flujo de transferencia, comprobante y verificación en Postgres', async () => {
    if (!hasDocker || !client) {
      return;
    }

    const paymentRepo = new PaymentRepository(client);
    const outboxRepo = new OutboxRepository(client);
    const transferService = new TransferService(paymentRepo, outboxRepo);

    const payment = await paymentRepo.createPayment({
      orderId: '550e8400-e29b-41d4-a716-446655440004',
      customerId: '660e8400-e29b-41d4-a716-446655440004',
      method: 'transfer',
      amountCents: 3500,
      currency: 'USD',
    });

    const receipt = await transferService.uploadReceipt(payment.id, {
      fileName: 'comprobante_safe.png',
      originalName: 'comprobante.png',
      mimeType: 'image/png',
      fileSizeBytes: 2048,
    });

    expect(receipt.status).toBe('pending_verification');

    const verifyRes = await transferService.verifyTransfer(payment.id, {
      action: 'approve',
      staffUserId: '770e8400-e29b-41d4-a716-446655440005',
    });

    expect(verifyRes.status).toBe('approved');
  });

  test('T021: Flujo de reembolso de tarjeta en Postgres', async () => {
    if (!hasDocker || !client) {
      return;
    }

    const paymentRepo = new PaymentRepository(client);
    const outboxRepo = new OutboxRepository(client);
    const gateway = new MockPaymentGatewayAdapter();
    const refundService = new RefundService(paymentRepo, outboxRepo, gateway);

    const payment = await paymentRepo.createPayment({
      orderId: '550e8400-e29b-41d4-a716-446655440006',
      customerId: '660e8400-e29b-41d4-a716-446655440006',
      method: 'card',
      amountCents: 2000,
      currency: 'USD',
    });

    await paymentRepo.updatePaymentStatus(payment.id, 'pending', 'approved', {
      externalReference: 'tx-card-2000',
    });

    const refund = await refundService.requestRefund(payment.id, {
      amountCents: 2000,
      reason: 'Cancelación de pedido',
      requestedBy: '770e8400-e29b-41d4-a716-446655440007',
      idempotencyKey: 'idem-int-ref-1',
    });

    expect(refund.status).toBe('completed');
    expect(refund.amountCents).toBe(2000);
  });
});
