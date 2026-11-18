import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  PaymentsService,
  InvalidSignatureError,
  DuplicatePaymentError,
} from '../../../apps/api/src/modules/pagos/services/payments.service.js';
import { MockPaymentGatewayAdapter } from '../../../apps/api/src/modules/pagos/services/gateway/mock-gateway.adapter.js';
import { CircuitBreaker } from '../../../apps/api/src/modules/pagos/services/gateway/circuit-breaker.js';
import type {
  PaymentEntity,
  PaymentRepository,
} from '../../../apps/api/src/modules/pagos/repositories/payment.repository.js';
import type { OutboxRepository } from '../../../apps/api/src/modules/pagos/repositories/outbox.repository.js';
import type { PaymentGatewayPort } from '../../../apps/api/src/modules/pagos/services/gateway/payment-gateway.port.js';

describe('US1: Pagar con tarjeta (Unit Tests - TDD)', () => {
  let mockPaymentRepo: { [K in keyof PaymentRepository]: ReturnType<typeof vi.fn> };
  let mockOutboxRepo: { [K in keyof OutboxRepository]: ReturnType<typeof vi.fn> };
  let gateway: MockPaymentGatewayAdapter;
  let service: PaymentsService;
  const webhookSecret = 'test_secret_12345';

  beforeEach(() => {
    mockPaymentRepo = {
      getIdempotencyKey: vi.fn().mockResolvedValue(null),
      saveIdempotencyKey: vi.fn().mockResolvedValue(undefined),
      findPaymentByOrderId: vi.fn().mockResolvedValue(null),
      findPaymentById: vi.fn().mockResolvedValue(null),
      createPayment: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          id: 'pay-uuid-1',
          orderId: data.orderId,
          customerId: data.customerId,
          method: data.method,
          status: 'pending',
          amountCents: data.amountCents,
          currency: 'USD',
          externalReference: null,
          idempotencyKey: data.idempotencyKey ?? null,
          failureReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as PaymentEntity),
      ),
      updatePaymentStatus: vi.fn().mockImplementation((id, current, next, opts) =>
        Promise.resolve({
          id,
          orderId: 'order-uuid-1',
          customerId: 'cust-uuid-1',
          method: 'card',
          status: next,
          amountCents: 1500,
          currency: 'USD',
          externalReference: opts?.externalReference ?? null,
          idempotencyKey: null,
          failureReason: opts?.failureReason ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as PaymentEntity),
      ),
      recordAuditLog: vi.fn().mockResolvedValue(undefined),
      countPendingCashOrdersByCustomer: vi.fn().mockResolvedValue(0),
    } as unknown as { [K in keyof PaymentRepository]: ReturnType<typeof vi.fn> };

    mockOutboxRepo = {
      saveEvent: vi.fn().mockResolvedValue('outbox-uuid-1'),
    } as unknown as { [K in keyof OutboxRepository]: ReturnType<typeof vi.fn> };

    gateway = new MockPaymentGatewayAdapter();
    service = new PaymentsService(
      mockPaymentRepo as unknown as PaymentRepository,
      mockOutboxRepo as unknown as OutboxRepository,
      gateway,
      { gatewayProvider: 'mock', webhookSecret, maxPendingCashOrders: 2 },
      new CircuitBreaker({ callTimeoutMs: 1000 }),
    );
  });

  describe('Inicio de intento de pago con tarjeta', () => {
    it('inicia sesión en la pasarela y retorna URL de redirección segura sin datos de tarjeta', async () => {
      const result = await service.createPaymentIntent({
        orderId: 'order-uuid-1',
        customerId: 'cust-uuid-1',
        method: 'card',
        amountCents: 1500,
        currency: 'USD',
        idempotencyKey: 'idem-1',
      });

      expect(result.paymentId).toBe('pay-uuid-1');
      expect(result.status).toBe('pending');
      expect(result.amountCents).toBe(1500);
      expect(result.gatewaySession).toBeDefined();
      expect(result.gatewaySession?.redirectUrl).toContain(
        'https://gateway-sandbox.example.com/checkout',
      );
      expect(mockPaymentRepo.createPayment).toHaveBeenCalledTimes(1);
      expect(mockPaymentRepo.saveIdempotencyKey).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'idem-1', responseStatus: 201 }),
      );
      expect(mockPaymentRepo.recordAuditLog).toHaveBeenCalledTimes(1);
    });

    it('retorna resultado guardado si la clave de idempotencia ya fue procesada', async () => {
      const cached = {
        paymentId: 'pay-uuid-cached',
        orderId: 'order-uuid-1',
        status: 'pending',
        amountCents: 1500,
      };
      mockPaymentRepo.getIdempotencyKey.mockResolvedValueOnce({
        key: 'idem-1',
        responseBody: cached,
        responseStatus: 201,
      });

      const result = await service.createPaymentIntent({
        orderId: 'order-uuid-1',
        customerId: 'cust-uuid-1',
        method: 'card',
        amountCents: 1500,
        currency: 'USD',
        idempotencyKey: 'idem-1',
      });

      expect(result).toEqual(cached);
      expect(mockPaymentRepo.createPayment).not.toHaveBeenCalled();
    });

    it('rechaza importes menores o iguales a cero o no enteros', async () => {
      await expect(
        service.createPaymentIntent({
          orderId: 'order-uuid-1',
          customerId: 'cust-uuid-1',
          method: 'card',
          amountCents: 0,
          currency: 'USD',
          idempotencyKey: 'idem-err',
        }),
      ).rejects.toThrow('El importe debe ser un entero positivo en centavos');

      await expect(
        service.createPaymentIntent({
          orderId: 'order-uuid-1',
          customerId: 'cust-uuid-1',
          method: 'card',
          amountCents: 12.5,
          currency: 'USD',
          idempotencyKey: 'idem-err',
        }),
      ).rejects.toThrow('El importe debe ser un entero positivo en centavos');
    });

    it('rechaza crear un pago si el pedido ya está pagado', async () => {
      mockPaymentRepo.findPaymentByOrderId.mockResolvedValueOnce({
        id: 'pay-prev',
        orderId: 'order-uuid-1',
        status: 'approved',
      });

      await expect(
        service.createPaymentIntent({
          orderId: 'order-uuid-1',
          customerId: 'cust-uuid-1',
          method: 'card',
          amountCents: 1500,
          currency: 'USD',
          idempotencyKey: 'idem-new',
        }),
      ).rejects.toThrow(DuplicatePaymentError);
    });
  });

  describe('Recepción y verificación de webhook', () => {
    it('rechaza webhooks con firma inválida o ausente', async () => {
      const rawPayload = JSON.stringify({ eventId: 'evt-1' });

      await expect(
        service.handleGatewayWebhook(rawPayload, 'invalid_signature_hex', { eventId: 'evt-1' }),
      ).rejects.toThrow(InvalidSignatureError);
    });

    it('procesa webhook firmado aprobado, transiciona a approved y emite outbox pago.confirmado', async () => {
      const payloadObj = {
        eventId: 'evt-succ-1',
        eventType: 'payment.succeeded',
        transactionId: 'tx-12345',
        orderReference: 'order-uuid-1',
        amountCents: 1500,
        currency: 'USD',
        timestamp: new Date().toISOString(),
      };
      const rawPayload = JSON.stringify(payloadObj);
      const signature = gateway.generateSignature(rawPayload, webhookSecret);

      mockPaymentRepo.findPaymentByOrderId.mockResolvedValueOnce({
        id: 'pay-uuid-1',
        orderId: 'order-uuid-1',
        customerId: 'cust-uuid-1',
        status: 'pending',
        amountCents: 1500,
      });

      const result = await service.handleGatewayWebhook(rawPayload, signature, payloadObj);

      expect(result.received).toBe(true);
      expect(result.status).toBe('approved');
      expect(mockPaymentRepo.updatePaymentStatus).toHaveBeenCalledWith(
        'pay-uuid-1',
        'pending',
        'approved',
        expect.objectContaining({ externalReference: 'tx-12345' }),
      );
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.confirmado',
        'pay-uuid-1',
        expect.objectContaining({
          paymentId: 'pay-uuid-1',
          orderId: 'order-uuid-1',
          method: 'card',
          amountCents: 1500,
        }),
      );
      expect(mockPaymentRepo.saveIdempotencyKey).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'evt-succ-1', responseStatus: 200 }),
      );
    });

    it('procesa webhook de rechazo, transiciona a rejected y emite outbox pago.rechazado', async () => {
      const payloadObj = {
        eventId: 'evt-fail-1',
        eventType: 'payment.failed',
        transactionId: 'tx-999',
        orderReference: 'order-uuid-1',
        amountCents: 1500,
        currency: 'USD',
        timestamp: new Date().toISOString(),
      };
      const rawPayload = JSON.stringify(payloadObj);
      const signature = gateway.generateSignature(rawPayload, webhookSecret);

      mockPaymentRepo.findPaymentByOrderId.mockResolvedValueOnce({
        id: 'pay-uuid-1',
        orderId: 'order-uuid-1',
        customerId: 'cust-uuid-1',
        status: 'pending',
        amountCents: 1500,
      });

      const result = await service.handleGatewayWebhook(rawPayload, signature, payloadObj);

      expect(result.received).toBe(true);
      expect(result.status).toBe('rejected');
      expect(mockPaymentRepo.updatePaymentStatus).toHaveBeenCalledWith(
        'pay-uuid-1',
        'pending',
        'rejected',
        expect.objectContaining({ externalReference: 'tx-999' }),
      );
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.rechazado',
        'pay-uuid-1',
        expect.objectContaining({ paymentId: 'pay-uuid-1', method: 'card' }),
      );
    });

    it('es idempotente ante webhooks duplicados (no vuelve a transicionar ni emite eventos duplicados)', async () => {
      const payloadObj = {
        eventId: 'evt-dup-1',
        eventType: 'payment.succeeded',
        transactionId: 'tx-dup-1',
        orderReference: 'order-uuid-1',
        amountCents: 1500,
        currency: 'USD',
      };
      const rawPayload = JSON.stringify(payloadObj);
      const signature = gateway.generateSignature(rawPayload, webhookSecret);

      mockPaymentRepo.getIdempotencyKey.mockResolvedValueOnce({
        key: 'evt-dup-1',
        responseStatus: 200,
        responseBody: { received: true, paymentId: 'pay-uuid-1', status: 'approved' },
      });

      const result = await service.handleGatewayWebhook(rawPayload, signature, payloadObj);

      expect(result.received).toBe(true);
      expect(mockPaymentRepo.updatePaymentStatus).not.toHaveBeenCalled();
      expect(mockOutboxRepo.saveEvent).not.toHaveBeenCalled();
    });
  });

  describe('Circuit Breaker de pasarela', () => {
    it('abre el circuito tras fallos repetidos para proteger la disponibilidad del sistema', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, callTimeoutMs: 100 });
      const failingGateway: PaymentGatewayPort = {
        createSession: vi.fn().mockRejectedValue(new Error('Gateway 500 error')),
        verifyWebhookSignature: vi.fn().mockReturnValue(false),
        parseWebhook: vi.fn(),
        queryPaymentStatus: vi.fn(),
        processRefund: vi.fn(),
      };
      const cbService = new PaymentsService(
        mockPaymentRepo as unknown as PaymentRepository,
        mockOutboxRepo as unknown as OutboxRepository,
        failingGateway,
        { gatewayProvider: 'mock', webhookSecret, maxPendingCashOrders: 2 },
        cb,
      );

      // Fallo 1
      await expect(
        cbService.createPaymentIntent({
          orderId: 'order-1',
          customerId: 'cust-1',
          method: 'card',
          amountCents: 1000,
          currency: 'USD',
          idempotencyKey: 'idem-fail-1',
        }),
      ).rejects.toThrow('Gateway 500 error');

      // Fallo 2
      await expect(
        cbService.createPaymentIntent({
          orderId: 'order-2',
          customerId: 'cust-1',
          method: 'card',
          amountCents: 1000,
          currency: 'USD',
          idempotencyKey: 'idem-fail-2',
        }),
      ).rejects.toThrow('Gateway 500 error');

      // El circuito debe estar OPEN ahora
      expect(cb.getState()).toBe('OPEN');

      // El siguiente intento falla de inmediato por CircuitBreakerOpenError sin llamar a la pasarela
      await expect(
        cbService.createPaymentIntent({
          orderId: 'order-3',
          customerId: 'cust-1',
          method: 'card',
          amountCents: 1000,
          currency: 'USD',
          idempotencyKey: 'idem-fail-3',
        }),
      ).rejects.toThrow('La pasarela de pago se encuentra temporalmente fuera de servicio');

      expect(failingGateway.createSession).toHaveBeenCalledTimes(2);
    });
  });
});
