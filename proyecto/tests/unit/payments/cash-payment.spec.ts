import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  CashPaymentService,
  InsufficientAmountReceivedError,
  InvalidPaymentStateError,
} from '../../../apps/api/src/modules/pagos/services/cash-payment.service.js';
import {
  CashLimitExceededError,
  PaymentNotFoundError,
} from '../../../apps/api/src/modules/pagos/services/payments.service.js';
import type {
  PaymentEntity,
  PaymentRepository,
} from '../../../apps/api/src/modules/pagos/repositories/payment.repository.js';
import type { OutboxRepository } from '../../../apps/api/src/modules/pagos/repositories/outbox.repository.js';

describe('US2: Pagar en efectivo (Unit Tests - TDD)', () => {
  let mockPaymentRepo: { [K in keyof PaymentRepository]: ReturnType<typeof vi.fn> };
  let mockOutboxRepo: { [K in keyof OutboxRepository]: ReturnType<typeof vi.fn> };
  let service: CashPaymentService;

  beforeEach(() => {
    mockPaymentRepo = {
      findPaymentById: vi.fn(),
      countPendingCashOrdersByCustomer: vi.fn().mockResolvedValue(0),
      updatePaymentStatus: vi.fn().mockImplementation((id, current, next) =>
        Promise.resolve({
          id,
          orderId: 'order-cash-1',
          customerId: 'cust-1',
          method: 'cash',
          status: next,
          amountCents: 850,
          currency: 'USD',
          externalReference: 'CASH-DESK',
          idempotencyKey: null,
          failureReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as PaymentEntity),
      ),
      recordAuditLog: vi.fn().mockResolvedValue(undefined),
    } as unknown as { [K in keyof PaymentRepository]: ReturnType<typeof vi.fn> };

    mockOutboxRepo = {
      saveEvent: vi.fn().mockResolvedValue('outbox-cash-1'),
    } as unknown as { [K in keyof OutboxRepository]: ReturnType<typeof vi.fn> };

    service = new CashPaymentService(
      mockPaymentRepo as unknown as PaymentRepository,
      mockOutboxRepo as unknown as OutboxRepository,
      {
        gatewayProvider: 'mock',
        webhookSecret: 'secret',
        maxPendingCashOrders: 2,
      },
    );
  });

  describe('Registro de cobro en mostrador', () => {
    it('registra cobro exitoso, calcula el cambio con exactitud en centavos y emite outbox', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-cash-1',
        orderId: 'order-cash-1',
        customerId: 'cust-1',
        method: 'cash',
        status: 'pending',
        amountCents: 850, // $8.50
      });

      const result = await service.collectCash('pay-cash-1', {
        amountReceivedCents: 1000, // $10.00
        staffUserId: 'staff-user-1',
      });

      expect(result.status).toBe('approved');
      expect(result.amountCents).toBe(850);
      expect(result.amountReceivedCents).toBe(1000);
      expect(result.changeCents).toBe(150); // $1.50 de cambio exacto
      expect(result.collectedBy).toBe('staff-user-1');

      expect(mockPaymentRepo.updatePaymentStatus).toHaveBeenCalledWith(
        'pay-cash-1',
        'pending',
        'approved',
        expect.anything(),
      );
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.confirmado',
        'pay-cash-1',
        expect.objectContaining({
          method: 'cash',
          amountCents: 850,
          changeCents: 150,
        }),
      );
      expect(mockPaymentRepo.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'staff-user-1',
          actorRole: 'personal',
          action: 'cash_payment_collected',
        }),
      );
    });

    it('permite cobro con importe exacto (cambio = 0 centavos)', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-cash-2',
        orderId: 'order-cash-2',
        customerId: 'cust-1',
        method: 'cash',
        status: 'pending',
        amountCents: 1200,
      });

      const result = await service.collectCash('pay-cash-2', {
        amountReceivedCents: 1200,
        staffUserId: 'staff-user-1',
      });

      expect(result.changeCents).toBe(0);
      expect(result.status).toBe('approved');
    });

    it('rechaza el cobro si el importe entregado por el cliente es insuficiente', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-cash-3',
        orderId: 'order-cash-3',
        customerId: 'cust-1',
        method: 'cash',
        status: 'pending',
        amountCents: 1500,
      });

      await expect(
        service.collectCash('pay-cash-3', {
          amountReceivedCents: 1400, // Falta $1.00
          staffUserId: 'staff-user-1',
        }),
      ).rejects.toThrow(InsufficientAmountReceivedError);

      expect(mockPaymentRepo.updatePaymentStatus).not.toHaveBeenCalled();
    });

    it('rechaza cobrar si el pedido no existe o ya fue cobrado previamente', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce(null);

      await expect(
        service.collectCash('non-existent', {
          amountReceivedCents: 2000,
          staffUserId: 'staff-user-1',
        }),
      ).rejects.toThrow(PaymentNotFoundError);

      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-cash-4',
        status: 'approved',
        method: 'cash',
      });

      await expect(
        service.collectCash('pay-cash-4', {
          amountReceivedCents: 2000,
          staffUserId: 'staff-user-1',
        }),
      ).rejects.toThrow(InvalidPaymentStateError);
    });

    it('rechaza cobrar como efectivo un pago de otro método', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-card-1',
        method: 'card',
        status: 'pending',
        amountCents: 1000,
      });

      await expect(
        service.collectCash('pay-card-1', {
          amountReceivedCents: 1000,
          staffUserId: 'staff-user-1',
        }),
      ).rejects.toThrow('El método de pago de este pedido no es efectivo');
    });
  });

  describe('Control de límites de pedidos en efectivo pendientes', () => {
    it('permite el pedido si el cliente tiene menos pedidos en efectivo del límite configurado', async () => {
      mockPaymentRepo.countPendingCashOrdersByCustomer.mockResolvedValueOnce(1);

      await expect(service.validateCanPayCash('cust-1')).resolves.toBeUndefined();
    });

    it('bloquea nuevos pedidos en efectivo si el cliente alcanza el límite máximo', async () => {
      mockPaymentRepo.countPendingCashOrdersByCustomer.mockResolvedValueOnce(2);

      await expect(service.validateCanPayCash('cust-1')).rejects.toThrow(CashLimitExceededError);
    });
  });
});
