import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  RefundService,
  InvalidRefundAmountError,
  PaymentNotRefundableError,
} from '../../../apps/api/src/modules/pagos/services/refund.service.js';
import type {
  PaymentEntity,
  PaymentRepository,
  RefundEntity,
} from '../../../apps/api/src/modules/pagos/repositories/payment.repository.js';
import type { OutboxRepository } from '../../../apps/api/src/modules/pagos/repositories/outbox.repository.js';
import { MockPaymentGatewayAdapter } from '../../../apps/api/src/modules/pagos/services/gateway/mock-gateway.adapter.js';

describe('US4: Reembolsos (Unit Tests - TDD)', () => {
  let mockPaymentRepo: { [K in keyof PaymentRepository]: ReturnType<typeof vi.fn> };
  let mockOutboxRepo: { [K in keyof OutboxRepository]: ReturnType<typeof vi.fn> };
  let gateway: MockPaymentGatewayAdapter;
  let service: RefundService;

  beforeEach(() => {
    mockPaymentRepo = {
      getIdempotencyKey: vi.fn().mockResolvedValue(null),
      saveIdempotencyKey: vi.fn().mockResolvedValue(undefined),
      findPaymentById: vi.fn(),
      updatePaymentStatus: vi.fn().mockResolvedValue(undefined),
      createRefund: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          id: 'ref-uuid-1',
          paymentId: data.paymentId,
          amountCents: data.amountCents,
          status: data.status,
          method: data.method,
          externalRefundId: data.externalRefundId ?? null,
          reason: data.reason,
          requestedBy: data.requestedBy,
          createdAt: new Date().toISOString(),
          completedAt: data.status === 'completed' ? new Date().toISOString() : null,
        } as RefundEntity),
      ),
      recordAuditLog: vi.fn().mockResolvedValue(undefined),
    } as unknown as { [K in keyof PaymentRepository]: ReturnType<typeof vi.fn> };

    mockOutboxRepo = {
      saveEvent: vi.fn().mockResolvedValue('outbox-ref-1'),
    } as unknown as { [K in keyof OutboxRepository]: ReturnType<typeof vi.fn> };

    gateway = new MockPaymentGatewayAdapter();
    service = new RefundService(
      mockPaymentRepo as unknown as PaymentRepository,
      mockOutboxRepo as unknown as OutboxRepository,
      gateway,
    );
  });

  describe('Procesamiento de reembolsos', () => {
    it('reembolsa automáticamente un pago de tarjeta a través de la pasarela y emite pago.reembolsado', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-card-approved',
        orderId: 'order-1',
        method: 'card',
        status: 'approved',
        amountCents: 1800,
        externalReference: 'tx-card-1800',
      } as PaymentEntity);

      const result = await service.requestRefund('pay-card-approved', {
        amountCents: 1800,
        reason: 'Cancelación solicitada por cliente antes de cocción',
        requestedBy: 'admin-user-1',
        idempotencyKey: 'idem-ref-1',
      });

      expect(result.status).toBe('completed');
      expect(result.method).toBe('card_gateway');
      expect(result.amountCents).toBe(1800);
      expect(mockPaymentRepo.updatePaymentStatus).toHaveBeenCalledWith(
        'pay-card-approved',
        'approved',
        'refunded',
      );
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.reembolsado',
        'pay-card-approved',
        expect.objectContaining({
          amountCents: 1800,
          method: 'card_gateway',
        }),
      );
      expect(mockPaymentRepo.saveIdempotencyKey).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'idem-ref-1', responseStatus: 200 }),
      );
    });

    it('deja el reembolso en estado pending para transferencias (gestión manual por personal)', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf-approved',
        orderId: 'order-2',
        method: 'transfer',
        status: 'approved',
        amountCents: 3000,
      } as PaymentEntity);

      const result = await service.requestRefund('pay-trf-approved', {
        amountCents: 3000,
        reason: 'Producto agotado',
        requestedBy: 'admin-user-1',
        idempotencyKey: 'idem-ref-2',
      });

      expect(result.status).toBe('pending');
      expect(result.method).toBe('manual_transfer');
      expect(mockPaymentRepo.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', method: 'manual_transfer' }),
      );
    });

    it('es estrictamente idempotente ante peticiones duplicadas de reembolso', async () => {
      const cached = {
        refundId: 'ref-cached-1',
        paymentId: 'pay-1',
        amountCents: 1500,
        status: 'completed',
      };
      mockPaymentRepo.getIdempotencyKey.mockResolvedValueOnce({
        key: 'idem-ref-dup',
        responseStatus: 200,
        responseBody: cached,
      });

      const result = await service.requestRefund('pay-1', {
        amountCents: 1500,
        reason: 'Duplicado',
        requestedBy: 'admin-1',
        idempotencyKey: 'idem-ref-dup',
      });

      expect(result).toEqual(cached);
      expect(mockPaymentRepo.createRefund).not.toHaveBeenCalled();
      expect(mockOutboxRepo.saveEvent).not.toHaveBeenCalled();
    });

    it('rechaza reembolsos de pagos que no se encuentren en estado approved', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-pending',
        status: 'pending',
      } as PaymentEntity);

      await expect(
        service.requestRefund('pay-pending', {
          amountCents: 1000,
          reason: 'Cancelación',
          requestedBy: 'admin-1',
          idempotencyKey: 'idem-fail',
        }),
      ).rejects.toThrow(PaymentNotRefundableError);
    });

    it('rechaza importes de reembolso mayores al total del pago o menores o iguales a cero', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-app',
        status: 'approved',
        amountCents: 1500,
      } as PaymentEntity);

      await expect(
        service.requestRefund('pay-app', {
          amountCents: 1600, // Mayor a 1500
          reason: 'Error',
          requestedBy: 'admin-1',
          idempotencyKey: 'idem-err',
        }),
      ).rejects.toThrow(InvalidRefundAmountError);

      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-app',
        status: 'approved',
        amountCents: 1500,
      } as PaymentEntity);

      await expect(
        service.requestRefund('pay-app', {
          amountCents: 0,
          reason: 'Error',
          requestedBy: 'admin-1',
          idempotencyKey: 'idem-err',
        }),
      ).rejects.toThrow(InvalidRefundAmountError);
    });
  });
});
