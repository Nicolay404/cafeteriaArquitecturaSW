import 'reflect-metadata';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PaymentsService,
  InvalidSignatureError,
  DuplicatePaymentError,
  CashLimitExceededError,
  PaymentNotFoundError,
} from './services/payments.service.js';
import {
  CashPaymentService,
  InsufficientAmountReceivedError,
  InvalidPaymentStateError,
} from './services/cash-payment.service.js';
import {
  TransferService,
  UnsupportedMediaTypeError,
  PayloadTooLargeError,
  ReceiptNotFoundError,
} from './services/transfer.service.js';
import {
  RefundService,
  InvalidRefundAmountError,
  PaymentNotRefundableError,
} from './services/refund.service.js';
import { MockPaymentGatewayAdapter } from './services/gateway/mock-gateway.adapter.js';
import { CircuitBreaker, CircuitBreakerOpenError } from './services/gateway/circuit-breaker.js';
import { PaymentsController } from './controllers/payments.controller.js';
import { WebhookController } from './controllers/webhook.controller.js';
import {
  PaymentRepository,
  type DbClient,
  type PaymentEntity,
  type TransferReceiptEntity,
  type RefundEntity,
} from './repositories/payment.repository.js';
import { OutboxRepository } from './repositories/outbox.repository.js';
import { PagosModule } from './pagos.module.js';
import { readPaymentsConfig } from './config.js';

type MockAsyncFn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
const mockFn = (): MockAsyncFn => jest.fn<(...args: unknown[]) => Promise<unknown>>();

describe('Módulo Pagos - Spec #7 (Comprehensive Unit Tests)', () => {
  let mockPaymentRepo: { [K in keyof PaymentRepository]: MockAsyncFn };
  let mockOutboxRepo: { [K in keyof OutboxRepository]: MockAsyncFn };
  let gateway: MockPaymentGatewayAdapter;
  let paymentsService: PaymentsService;
  let cashService: CashPaymentService;
  let transferService: TransferService;
  let refundService: RefundService;
  let paymentsController: PaymentsController;
  let webhookController: WebhookController;
  const webhookSecret = 'test_webhook_secret_12345';

  beforeEach(() => {
    mockPaymentRepo = {
      getIdempotencyKey: mockFn().mockResolvedValue(null),
      saveIdempotencyKey: mockFn().mockResolvedValue(undefined),
      findPaymentById: mockFn().mockResolvedValue(null),
      findPaymentByOrderId: mockFn().mockResolvedValue(null),
      createPayment: mockFn().mockImplementation((...args: unknown[]) => {
        const data = args[0] as {
          orderId: string;
          customerId: string;
          method: 'card' | 'cash' | 'transfer';
          amountCents: number;
          idempotencyKey?: string;
        };
        return Promise.resolve({
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
        } as PaymentEntity);
      }),
      updatePaymentStatus: mockFn().mockImplementation((...args: unknown[]) => {
        const id = args[0] as string;
        const next = args[2] as 'pending' | 'approved' | 'rejected' | 'refunded';
        const opts = args[3] as { externalReference?: string; failureReason?: string } | undefined;
        return Promise.resolve({
          id,
          orderId: 'order-uuid-1',
          customerId: 'cust-uuid-1',
          method: 'transfer',
          status: next,
          amountCents: 2000,
          currency: 'USD',
          externalReference: opts?.externalReference ?? null,
          idempotencyKey: null,
          failureReason: opts?.failureReason ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as PaymentEntity);
      }),
      countPendingCashOrdersByCustomer: mockFn().mockResolvedValue(0),
      saveTransferReceipt: mockFn().mockImplementation((...args: unknown[]) => {
        const data = args[0] as {
          paymentId: string;
          fileName: string;
          originalName: string;
          mimeType: string;
          fileSizeBytes: number;
        };
        return Promise.resolve({
          id: 'rec-uuid-1',
          paymentId: data.paymentId,
          fileName: data.fileName,
          originalName: data.originalName,
          mimeType: data.mimeType,
          fileSizeBytes: data.fileSizeBytes,
          status: 'pending_verification',
          verifiedBy: null,
          rejectionReason: null,
          verifiedAt: null,
          createdAt: new Date().toISOString(),
          retentionUntil: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
        } as TransferReceiptEntity);
      }),
      findTransferReceiptByPaymentId: mockFn().mockResolvedValue(null),
      updateTransferReceiptStatus: mockFn().mockResolvedValue(undefined),
      createRefund: mockFn().mockImplementation((...args: unknown[]) => {
        const data = args[0] as {
          paymentId: string;
          amountCents: number;
          status: 'pending' | 'completed' | 'failed';
          method: 'card_gateway' | 'manual_transfer' | 'cash_desk';
          externalRefundId?: string;
          reason: string;
          requestedBy: string;
        };
        return Promise.resolve({
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
        } as RefundEntity);
      }),
      recordAuditLog: mockFn().mockResolvedValue(undefined),
    } as unknown as { [K in keyof PaymentRepository]: MockAsyncFn };

    mockOutboxRepo = {
      saveEvent: mockFn().mockResolvedValue('outbox-uuid-1'),
      fetchPendingEvents: mockFn().mockResolvedValue([]),
      markEventPublished: mockFn().mockResolvedValue(undefined),
      markEventFailed: mockFn().mockResolvedValue(undefined),
    } as unknown as { [K in keyof OutboxRepository]: MockAsyncFn };

    gateway = new MockPaymentGatewayAdapter();
    const config = { gatewayProvider: 'mock' as const, webhookSecret, maxPendingCashOrders: 2 };

    paymentsService = new PaymentsService(
      mockPaymentRepo as unknown as PaymentRepository,
      mockOutboxRepo as unknown as OutboxRepository,
      gateway,
      config,
      new CircuitBreaker({ callTimeoutMs: 1000 }),
    );

    cashService = new CashPaymentService(
      mockPaymentRepo as unknown as PaymentRepository,
      mockOutboxRepo as unknown as OutboxRepository,
      config,
    );

    transferService = new TransferService(
      mockPaymentRepo as unknown as PaymentRepository,
      mockOutboxRepo as unknown as OutboxRepository,
    );

    refundService = new RefundService(
      mockPaymentRepo as unknown as PaymentRepository,
      mockOutboxRepo as unknown as OutboxRepository,
      gateway,
    );

    paymentsController = new PaymentsController(
      paymentsService,
      cashService,
      transferService,
      refundService,
    );

    webhookController = new WebhookController(paymentsService);
  });

  describe('US1: Tarjeta de crédito', () => {
    it('crea intención de pago y retorna sesión de pasarela', async () => {
      const result = await paymentsService.createPaymentIntent({
        orderId: 'order-1',
        customerId: 'cust-1',
        method: 'card',
        amountCents: 1500,
        currency: 'USD',
        idempotencyKey: 'idem-1',
      });

      expect(result.status).toBe('pending');
      expect(result.gatewaySession?.redirectUrl).toContain('gateway-sandbox');
      expect(mockPaymentRepo.saveIdempotencyKey).toHaveBeenCalledTimes(1);
    });

    it('procesa webhook firmado y emite outbox pago.confirmado', async () => {
      const payload = {
        eventId: 'evt-1',
        eventType: 'payment.succeeded' as const,
        transactionId: 'tx-1',
        orderReference: 'order-1',
        amountCents: 1500,
        currency: 'USD',
        signature: '',
        timestamp: new Date().toISOString(),
      };
      const raw = JSON.stringify(payload);
      const signature = gateway.generateSignature(raw, webhookSecret);

      mockPaymentRepo.findPaymentByOrderId.mockResolvedValueOnce({
        id: 'pay-uuid-1',
        orderId: 'order-1',
        customerId: 'cust-1',
        status: 'pending',
        amountCents: 1500,
      });

      mockPaymentRepo.updatePaymentStatus.mockResolvedValueOnce({
        id: 'pay-uuid-1',
        orderId: 'order-1',
        customerId: 'cust-1',
        method: 'card',
        status: 'approved',
        amountCents: 1500,
        currency: 'USD',
      });

      const res = await paymentsService.handleGatewayWebhook(raw, signature, payload);
      expect(res.received).toBe(true);
      expect(res.status).toBe('approved');
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.confirmado',
        'pay-uuid-1',
        expect.objectContaining({ method: 'card', amountCents: 1500 }),
      );
    });

    it('procesa webhook de rechazo de pago', async () => {
      const payload = {
        eventId: 'evt-fail',
        eventType: 'payment.failed' as const,
        transactionId: 'tx-fail',
        orderReference: 'order-1',
        amountCents: 1500,
        currency: 'USD',
        signature: '',
        timestamp: new Date().toISOString(),
      };
      const raw = JSON.stringify(payload);
      const signature = gateway.generateSignature(raw, webhookSecret);

      mockPaymentRepo.findPaymentByOrderId.mockResolvedValueOnce({
        id: 'pay-uuid-1',
        orderId: 'order-1',
        customerId: 'cust-1',
        status: 'pending',
        amountCents: 1500,
      });

      mockPaymentRepo.updatePaymentStatus.mockResolvedValueOnce({
        id: 'pay-uuid-1',
        orderId: 'order-1',
        customerId: 'cust-1',
        method: 'card',
        status: 'rejected',
        amountCents: 1500,
        currency: 'USD',
      });

      const res = await paymentsService.handleGatewayWebhook(raw, signature, payload);
      expect(res.received).toBe(true);
      expect(res.status).toBe('rejected');
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.rechazado',
        'pay-uuid-1',
        expect.objectContaining({ method: 'card' }),
      );
    });

    it('es idempotente ante webhook repetido', async () => {
      const payload = {
        eventId: 'evt-dup',
        eventType: 'payment.succeeded' as const,
        transactionId: 'tx-dup',
        orderReference: 'order-1',
        amountCents: 1500,
        currency: 'USD',
      };
      const raw = JSON.stringify(payload);
      const signature = gateway.generateSignature(raw, webhookSecret);

      mockPaymentRepo.getIdempotencyKey.mockResolvedValueOnce({
        key: 'evt-dup',
        responseBody: { received: true, status: 'approved' },
      });

      const res = await paymentsService.handleGatewayWebhook(raw, signature, payload);
      expect(res.received).toBe(true);
      expect(mockPaymentRepo.updatePaymentStatus).not.toHaveBeenCalled();
    });

    it('rechaza webhook no firmado', async () => {
      await expect(paymentsService.handleGatewayWebhook('{}', 'bad_sig', {})).rejects.toThrow(
        InvalidSignatureError,
      );
    });

    it('lanza PaymentNotFoundError si el pedido referenciado en webhook no existe', async () => {
      const payload = {
        eventId: 'evt-404',
        eventType: 'payment.succeeded' as const,
        transactionId: 'tx-404',
        orderReference: 'non-existent-order',
        amountCents: 1000,
        currency: 'USD',
      };
      const raw = JSON.stringify(payload);
      const signature = gateway.generateSignature(raw, webhookSecret);

      mockPaymentRepo.findPaymentByOrderId.mockResolvedValueOnce(null);

      await expect(paymentsService.handleGatewayWebhook(raw, signature, payload)).rejects.toThrow(
        PaymentNotFoundError,
      );
    });

    it('webhook recibido para un pago que ya estaba approved retorna status approved idempotentemente', async () => {
      const payload = {
        eventId: 'evt-already-approved',
        eventType: 'payment.succeeded' as const,
        transactionId: 'tx-2',
        orderReference: 'order-already-approved',
        amountCents: 1500,
        currency: 'USD',
      };
      const raw = JSON.stringify(payload);
      const signature = gateway.generateSignature(raw, webhookSecret);

      mockPaymentRepo.findPaymentByOrderId.mockResolvedValueOnce({
        id: 'pay-approved-already',
        status: 'approved',
      });

      const res = await paymentsService.handleGatewayWebhook(raw, signature, payload);
      expect(res.received).toBe(true);
      expect(res.status).toBe('approved');
      expect(mockPaymentRepo.updatePaymentStatus).not.toHaveBeenCalled();
    });
  });

  describe('US2: Efectivo', () => {
    it('registra cobro en mostrador y calcula cambio con exactitud', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-cash',
        orderId: 'order-cash',
        customerId: 'cust-1',
        method: 'cash',
        status: 'pending',
        amountCents: 750,
      });

      const res = await cashService.collectCash('pay-cash', {
        amountReceivedCents: 1000,
        staffUserId: 'staff-1',
      });

      expect(res.status).toBe('approved');
      expect(res.changeCents).toBe(250);
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.confirmado',
        'pay-cash',
        expect.objectContaining({ method: 'cash', changeCents: 250 }),
      );
    });

    it('rechaza monto recibido insuficiente', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-cash',
        method: 'cash',
        status: 'pending',
        amountCents: 1000,
      });

      await expect(
        cashService.collectCash('pay-cash', {
          amountReceivedCents: 900,
          staffUserId: 'staff-1',
        }),
      ).rejects.toThrow(InsufficientAmountReceivedError);
    });

    it('rechaza cobrar un pedido que no es efectivo o no está pendiente', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-card',
        method: 'card',
        status: 'pending',
      });

      await expect(
        cashService.collectCash('pay-card', {
          amountReceivedCents: 1000,
          staffUserId: 'staff-1',
        }),
      ).rejects.toThrow('El método de pago de este pedido no es efectivo');

      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-approved',
        method: 'cash',
        status: 'approved',
      });

      await expect(
        cashService.collectCash('pay-approved', {
          amountReceivedCents: 1000,
          staffUserId: 'staff-1',
        }),
      ).rejects.toThrow(InvalidPaymentStateError);
    });

    it('valida límite de pedidos en efectivo pendientes por cliente', async () => {
      mockPaymentRepo.countPendingCashOrdersByCustomer.mockResolvedValueOnce(2);

      await expect(cashService.validateCanPayCash('cust-1')).rejects.toThrow(
        CashLimitExceededError,
      );
    });
  });

  describe('US3: Transferencia', () => {
    it('sube comprobante con retención LOPDP de 90 días', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf',
        method: 'transfer',
        customerId: 'cust-1',
      });

      const res = await transferService.uploadReceipt('pay-trf', {
        fileName: 'rec.png',
        originalName: 'rec.png',
        mimeType: 'image/png',
        fileSizeBytes: 1000,
      });

      expect(res.status).toBe('pending_verification');
      expect(res.retentionUntil).toBeDefined();
    });

    it('rechaza archivos mayores a 5 MB o tipo MIME no permitido', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValue({
        id: 'pay-trf',
        method: 'transfer',
      });

      await expect(
        transferService.uploadReceipt('pay-trf', {
          fileName: 'rec.exe',
          originalName: 'rec.exe',
          mimeType: 'application/x-msdownload',
          fileSizeBytes: 100,
        }),
      ).rejects.toThrow(UnsupportedMediaTypeError);

      await expect(
        transferService.uploadReceipt('pay-trf', {
          fileName: 'rec.pdf',
          originalName: 'rec.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 6 * 1024 * 1024,
        }),
      ).rejects.toThrow(PayloadTooLargeError);
    });

    it('personal aprueba transferencia', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf',
        orderId: 'order-trf',
        customerId: 'cust-1',
        method: 'transfer',
        status: 'pending',
        amountCents: 2000,
      });
      mockPaymentRepo.findTransferReceiptByPaymentId.mockResolvedValueOnce({
        id: 'rec-1',
      });

      const res = await transferService.verifyTransfer('pay-trf', {
        action: 'approve',
        staffUserId: 'staff-1',
      });

      expect(res.status).toBe('approved');
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.confirmado',
        'pay-trf',
        expect.objectContaining({ method: 'transfer', amountCents: 2000 }),
      );
    });

    it('personal rechaza transferencia con motivo', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf',
        orderId: 'order-trf',
        customerId: 'cust-1',
        method: 'transfer',
        status: 'pending',
        amountCents: 2000,
      });
      mockPaymentRepo.findTransferReceiptByPaymentId.mockResolvedValueOnce({
        id: 'rec-1',
      });

      const res = await transferService.verifyTransfer('pay-trf', {
        action: 'reject',
        staffUserId: 'staff-1',
        rejectionReason: 'Comprobante ilegible',
      });

      expect(res.status).toBe('rejected');
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.rechazado',
        'pay-trf',
        expect.objectContaining({ reason: 'Comprobante ilegible' }),
      );
    });
  });

  describe('US4: Reembolsos', () => {
    it('reembolsa pago de tarjeta de forma automática e idempotente', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-card',
        orderId: 'order-1',
        method: 'card',
        status: 'approved',
        amountCents: 1500,
        externalReference: 'tx-1',
      });

      const res = await refundService.requestRefund('pay-card', {
        amountCents: 1500,
        reason: 'Cancelado',
        requestedBy: 'admin-1',
        idempotencyKey: 'idem-ref-1',
      });

      expect(res.status).toBe('completed');
      expect(res.method).toBe('card_gateway');
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.reembolsado',
        'pay-card',
        expect.objectContaining({ amountCents: 1500 }),
      );
    });

    it('reembolso de transferencia queda en estado pending para tesorería', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf',
        orderId: 'order-2',
        method: 'transfer',
        status: 'approved',
        amountCents: 2500,
      });

      const res = await refundService.requestRefund('pay-trf', {
        amountCents: 2500,
        reason: 'Cancelado',
        requestedBy: 'admin-1',
        idempotencyKey: 'idem-ref-2',
      });

      expect(res.status).toBe('pending');
      expect(res.method).toBe('manual_transfer');
    });

    it('reembolsa pago en efectivo en mostrador', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-cash',
        orderId: 'order-3',
        method: 'cash',
        status: 'approved',
        amountCents: 1200,
      });

      const res = await refundService.requestRefund('pay-cash', {
        amountCents: 1200,
        reason: 'Cancelación en mostrador',
        requestedBy: 'staff-1',
        idempotencyKey: 'idem-ref-cash',
      });

      expect(res.status).toBe('completed');
      expect(res.method).toBe('cash_desk');
    });

    it('rechaza reembolsar si el estado no es approved o monto es inválido', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-pend',
        status: 'pending',
        amountCents: 1000,
      });

      await expect(
        refundService.requestRefund('pay-pend', {
          amountCents: 1000,
          reason: 'Error',
          requestedBy: 'admin-1',
          idempotencyKey: 'idem-fail',
        }),
      ).rejects.toThrow(PaymentNotRefundableError);

      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-app',
        status: 'approved',
        amountCents: 1000,
      });

      await expect(
        refundService.requestRefund('pay-app', {
          amountCents: 2000,
          reason: 'Error',
          requestedBy: 'admin-1',
          idempotencyKey: 'idem-fail-2',
        }),
      ).rejects.toThrow(InvalidRefundAmountError);
    });
  });

  describe('CircuitBreaker', () => {
    it('abre el circuito tras umbral de fallos y recupera en HALF_OPEN', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 50,
        callTimeoutMs: 100,
      });
      let shouldFail = true;

      const op = () => (shouldFail ? Promise.reject(new Error('fail')) : Promise.resolve('ok'));

      await expect(cb.execute(op)).rejects.toThrow('fail');
      await expect(cb.execute(op)).rejects.toThrow('fail');
      expect(cb.getState()).toBe('OPEN');

      await expect(cb.execute(op)).rejects.toThrow(CircuitBreakerOpenError);

      // Esperar resetTimeoutMs
      await new Promise((r) => setTimeout(r, 60));
      expect(cb.getState()).toBe('HALF_OPEN');

      shouldFail = false;
      const res = await cb.execute(op);
      expect(res).toBe('ok');
      expect(cb.getState()).toBe('CLOSED');
    });
  });

  describe('PaymentRepository & OutboxRepository con DbClient mock', () => {
    it('PaymentRepository ejecuta todas las operaciones SQL', async () => {
      const fakeRow = {
        id: 'pay-1',
        orderId: 'order-1',
        customerId: 'cust-1',
        method: 'card',
        status: 'pending',
        amountCents: 1000,
        currency: 'USD',
        externalReference: null,
        idempotencyKey: 'key-1',
        failureReason: null,
        createdAt: '2026-11-18',
        updatedAt: '2026-11-18',
        count: 1,
      };
      const mockDb: DbClient = {
        query: mockFn().mockResolvedValue({
          rows: [fakeRow],
          rowCount: 1,
        }) as unknown as DbClient['query'],
      };

      const repo = new PaymentRepository(mockDb);

      await repo.createPayment({
        orderId: 'order-1',
        customerId: 'cust-1',
        method: 'card',
        amountCents: 1000,
      });
      await repo.findPaymentById('pay-1');
      await repo.findPaymentByOrderId('order-1');
      await repo.updatePaymentStatus('pay-1', 'pending', 'approved', {
        externalReference: 'ref-1',
      });
      await repo.countPendingCashOrdersByCustomer('cust-1');
      await repo.saveIdempotencyKey({
        key: 'k-1',
        action: 'test',
        responseStatus: 200,
        responseBody: {},
      });
      await repo.getIdempotencyKey('k-1');
      await repo.saveTransferReceipt({
        paymentId: 'pay-1',
        fileName: 'file.png',
        originalName: 'file.png',
        mimeType: 'image/png',
        fileSizeBytes: 100,
      });
      await repo.findTransferReceiptByPaymentId('pay-1');
      await repo.updateTransferReceiptStatus('rec-1', 'verified', 'staff-1');
      await repo.createRefund({
        paymentId: 'pay-1',
        amountCents: 1000,
        method: 'card_gateway',
        reason: 'test',
        requestedBy: 'admin-1',
      });
      await repo.recordAuditLog({
        paymentId: 'pay-1',
        action: 'test',
        actorId: 'admin-1',
        actorRole: 'admin',
      });

      expect(mockDb.query).toHaveBeenCalledTimes(12);
    });

    it('OutboxRepository guarda y actualiza eventos', async () => {
      const mockDb: DbClient = {
        query: mockFn().mockResolvedValue({
          rows: [{ id: 'evt-1', eventName: 'pago.confirmado', status: 'pending' }],
          rowCount: 1,
        }) as unknown as DbClient['query'],
      };

      const repo = new OutboxRepository(mockDb);
      const id = await repo.saveEvent('pago.confirmado', 'agg-1', { foo: 'bar' });
      expect(id).toBe('evt-1');

      const events = await repo.fetchPendingEvents();
      expect(events).toHaveLength(1);

      await repo.markEventPublished('evt-1');
      await repo.markEventFailed('evt-1');
      expect(mockDb.query).toHaveBeenCalledTimes(4);
    });
  });

  describe('Controladores HTTP y PagosModule', () => {
    it('PaymentsController maneja creación de intención y 422 en exceso de efectivo', async () => {
      mockPaymentRepo.createPayment.mockResolvedValueOnce({
        id: 'pay-ctrl-1',
        orderId: 'order-1',
        customerId: 'cust-1',
        method: 'card',
        status: 'pending',
        amountCents: 1000,
        currency: 'USD',
        createdAt: new Date().toISOString(),
      });

      const res = await paymentsController.createIntent('idem-ctrl', {
        orderId: 'order-1',
        customerId: 'cust-1',
        method: 'card',
        amountCents: 1000,
        currency: 'USD',
      });
      expect(res.paymentId).toBe('pay-ctrl-1');

      mockPaymentRepo.countPendingCashOrdersByCustomer.mockResolvedValueOnce(5);
      await expect(
        paymentsController.createIntent('idem-ctrl-2', {
          orderId: 'order-2',
          customerId: 'cust-1',
          method: 'cash',
          amountCents: 1000,
          currency: 'USD',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('PaymentsController consulta pago y lanza 404 si no existe', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce(null);
      await expect(paymentsController.getPayment('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('PaymentsController maneja cobro en efectivo y errores', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-cash',
        orderId: 'order-1',
        customerId: 'cust-1',
        method: 'cash',
        status: 'pending',
        amountCents: 500,
      });

      const res = await paymentsController.collectCash('pay-cash', {
        amountReceivedCents: 1000,
        staffUserId: 'staff-1',
      });
      expect(res.changeCents).toBe(500);

      mockPaymentRepo.findPaymentById.mockResolvedValueOnce(null);
      await expect(
        paymentsController.collectCash('pay-404', {
          amountReceivedCents: 1000,
          staffUserId: 'staff-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('PaymentsController sube comprobante y verifica transferencia', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf',
        method: 'transfer',
        customerId: 'cust-1',
      });

      const receipt = await paymentsController.uploadReceipt('pay-trf', {
        fileName: 'safe.png',
        originalName: 'orig.png',
        mimeType: 'image/png',
        fileSizeBytes: 500,
      });
      expect(receipt.status).toBe('pending_verification');

      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf',
        orderId: 'order-1',
        customerId: 'cust-1',
        method: 'transfer',
        status: 'pending',
        amountCents: 1000,
      });
      mockPaymentRepo.findTransferReceiptByPaymentId.mockResolvedValueOnce({
        id: 'rec-1',
      });

      const verified = await paymentsController.verifyTransfer('pay-trf', {
        action: 'approve',
        staffUserId: 'staff-1',
      });
      expect(verified.status).toBe('approved');
    });

    it('PaymentsController solicita reembolso y maneja errores', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-card',
        orderId: 'order-1',
        method: 'card',
        status: 'approved',
        amountCents: 1000,
      });

      const res = await paymentsController.requestRefund('pay-card', 'idem-ref', {
        amountCents: 1000,
        reason: 'Cancelado',
        requestedBy: 'admin-1',
      });
      expect(res.status).toBe('completed');

      mockPaymentRepo.findPaymentById.mockResolvedValueOnce(null);
      await expect(
        paymentsController.requestRefund('pay-none', 'idem-ref', {
          amountCents: 1000,
          reason: 'Cancelado',
          requestedBy: 'admin-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('WebhookController lanza 401 si falta encabezado de firma o es inválida', async () => {
      await expect(webhookController.handleWebhook(undefined, {})).rejects.toThrow(
        UnauthorizedException,
      );

      await expect(webhookController.handleWebhook('bad-sig', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('PaymentsController mapea todos los errores de validación y de negocio', async () => {
      // uploadReceipt con errores
      jest
        .spyOn(transferService, 'uploadReceipt')
        .mockRejectedValueOnce(new PayloadTooLargeError());
      await expect(
        paymentsController.uploadReceipt('pay-1', {
          fileName: 'f',
          originalName: 'f',
          mimeType: 'image/png',
          fileSizeBytes: 100,
        }),
      ).rejects.toThrow(BadRequestException);

      jest
        .spyOn(transferService, 'uploadReceipt')
        .mockRejectedValueOnce(new UnsupportedMediaTypeError());
      await expect(
        paymentsController.uploadReceipt('pay-1', {
          fileName: 'f',
          originalName: 'f',
          mimeType: 'image/png',
          fileSizeBytes: 100,
        }),
      ).rejects.toThrow(BadRequestException);

      // verifyTransfer con errores
      jest
        .spyOn(transferService, 'verifyTransfer')
        .mockRejectedValueOnce(new ReceiptNotFoundError());
      await expect(
        paymentsController.verifyTransfer('pay-1', { action: 'approve', staffUserId: 'staff-1' }),
      ).rejects.toThrow(NotFoundException);

      // collectCash con InsufficientAmountReceivedError
      jest
        .spyOn(cashService, 'collectCash')
        .mockRejectedValueOnce(new InsufficientAmountReceivedError());
      await expect(
        paymentsController.collectCash('pay-1', {
          amountReceivedCents: 50,
          staffUserId: 'staff-1',
        }),
      ).rejects.toThrow(BadRequestException);

      // requestRefund con errores
      jest
        .spyOn(refundService, 'requestRefund')
        .mockRejectedValueOnce(new PaymentNotRefundableError());
      await expect(
        paymentsController.requestRefund('pay-1', 'key', {
          amountCents: 100,
          reason: 'r',
          requestedBy: 'u',
        }),
      ).rejects.toThrow(BadRequestException);

      jest
        .spyOn(refundService, 'requestRefund')
        .mockRejectedValueOnce(new InvalidRefundAmountError());
      await expect(
        paymentsController.requestRefund('pay-1', 'key', {
          amountCents: 100,
          reason: 'r',
          requestedBy: 'u',
        }),
      ).rejects.toThrow(BadRequestException);

      // WebhookController con error interno
      jest
        .spyOn(paymentsService, 'handleGatewayWebhook')
        .mockRejectedValueOnce(new Error('DB connection fail'));
      await expect(webhookController.handleWebhook('sig', {})).rejects.toThrow(BadRequestException);
    });

    it('MockPaymentGatewayAdapter cubre validaciones y consulta de estado', async () => {
      expect(gateway.verifyWebhookSignature('', '', '')).toBe(false);
      expect(gateway.verifyWebhookSignature('payload', 'bad-len', 'secret')).toBe(false);

      expect(() => gateway.parseWebhook('invalid-type')).toThrow();
      expect(() => gateway.parseWebhook({})).toThrow('Campos obligatorios');

      const status = await gateway.queryPaymentStatus('non-existent');
      expect(status.status).toBe('pending');
    });

    it('cubre ramas de validación directa en PaymentsService', async () => {
      // Importe no positivo o no entero
      await expect(
        paymentsService.createPaymentIntent({
          orderId: 'order-1',
          customerId: 'cust-1',
          method: 'card',
          amountCents: 0,
          currency: 'USD',
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow();

      // Idempotencia encontrada en createPaymentIntent
      mockPaymentRepo.getIdempotencyKey.mockResolvedValueOnce({
        responseBody: { paymentId: 'cached-p' },
      });
      const cached = await paymentsService.createPaymentIntent({
        orderId: 'order-1',
        customerId: 'cust-1',
        method: 'card',
        amountCents: 1000,
        currency: 'USD',
        idempotencyKey: 'k',
      });
      expect(cached.paymentId).toBe('cached-p');

      // Pedido ya pagado previamente
      mockPaymentRepo.findPaymentByOrderId.mockResolvedValueOnce({
        id: 'p-prev',
        status: 'approved',
      });
      await expect(
        paymentsService.createPaymentIntent({
          orderId: 'order-1',
          customerId: 'cust-1',
          method: 'card',
          amountCents: 1000,
          currency: 'USD',
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(DuplicatePaymentError);

      // Límite de efectivo en PaymentsService
      mockPaymentRepo.countPendingCashOrdersByCustomer.mockResolvedValueOnce(5);
      await expect(
        paymentsService.createPaymentIntent({
          orderId: 'order-1',
          customerId: 'cust-1',
          method: 'cash',
          amountCents: 1000,
          currency: 'USD',
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(CashLimitExceededError);

      // getPaymentById
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({ id: 'p-found' });
      const found = await paymentsService.getPaymentById('p-found');
      expect(found?.id).toBe('p-found');
    });

    it('cubre ramas de validación en TransferService', async () => {
      // Método no es transfer
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'p-card',
        method: 'card',
      });
      await expect(
        transferService.uploadReceipt('p-card', {
          fileName: 'f.png',
          originalName: 'f.png',
          mimeType: 'image/png',
          fileSizeBytes: 100,
        }),
      ).rejects.toThrow('no corresponde al método de transferencia');

      // Pago no existe en verifyTransfer
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce(null);
      await expect(
        transferService.verifyTransfer('p-none', { action: 'approve', staffUserId: 'u' }),
      ).rejects.toThrow(PaymentNotFoundError);

      // Comprobante no existe en verifyTransfer
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({ id: 'p-ok' });
      mockPaymentRepo.findTransferReceiptByPaymentId.mockResolvedValueOnce(null);
      await expect(
        transferService.verifyTransfer('p-ok', { action: 'approve', staffUserId: 'u' }),
      ).rejects.toThrow(ReceiptNotFoundError);

      // Rechazo sin motivo
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({ id: 'p-ok' });
      mockPaymentRepo.findTransferReceiptByPaymentId.mockResolvedValueOnce({ id: 'r-ok' });
      await expect(
        transferService.verifyTransfer('p-ok', {
          action: 'reject',
          staffUserId: 'u',
          rejectionReason: ' ',
        }),
      ).rejects.toThrow('Se requiere un motivo explicativo');
    });

    it('PaymentsController cubre casos de error genéricos', async () => {
      // createIntent error genérico
      jest.spyOn(paymentsService, 'createPaymentIntent').mockRejectedValueOnce(new Error('fail'));
      await expect(
        paymentsController.createIntent(undefined, {
          orderId: 'o',
          customerId: 'c',
          method: 'card',
          amountCents: 100,
          currency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);

      // collectCash error genérico
      jest.spyOn(cashService, 'collectCash').mockRejectedValueOnce(new Error('fail'));
      await expect(
        paymentsController.collectCash('p', { amountReceivedCents: 100, staffUserId: 'u' }),
      ).rejects.toThrow(BadRequestException);

      // uploadReceipt PaymentNotFoundError y error genérico
      jest
        .spyOn(transferService, 'uploadReceipt')
        .mockRejectedValueOnce(new PaymentNotFoundError());
      await expect(
        paymentsController.uploadReceipt('p', {
          fileName: 'f',
          originalName: 'f',
          mimeType: 'image/png',
          fileSizeBytes: 10,
        }),
      ).rejects.toThrow(NotFoundException);

      jest.spyOn(transferService, 'uploadReceipt').mockRejectedValueOnce(new Error('fail'));
      await expect(
        paymentsController.uploadReceipt('p', {
          fileName: 'f',
          originalName: 'f',
          mimeType: 'image/png',
          fileSizeBytes: 10,
        }),
      ).rejects.toThrow(BadRequestException);

      // verifyTransfer error genérico
      jest.spyOn(transferService, 'verifyTransfer').mockRejectedValueOnce(new Error('fail'));
      await expect(
        paymentsController.verifyTransfer('p', { action: 'approve', staffUserId: 'u' }),
      ).rejects.toThrow(BadRequestException);

      // requestRefund error genérico
      jest.spyOn(refundService, 'requestRefund').mockRejectedValueOnce(new Error('fail'));
      await expect(
        paymentsController.requestRefund('p', undefined, {
          amountCents: 100,
          reason: 'r',
          requestedBy: 'u',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('PagosModule.register configura y exporta proveedores dinámicamente', () => {
      const mockDb: DbClient = {
        query: mockFn().mockResolvedValue({ rows: [] }) as unknown as DbClient['query'],
      };
      const dynModule = PagosModule.register({
        db: mockDb,
        config: {
          gatewayProvider: 'mock',
          webhookSecret: 's',
          maxPendingCashOrders: 2,
        },
      });

      expect(dynModule.module).toBe(PagosModule);
      expect(dynModule.controllers).toBeDefined();
      expect(dynModule.providers).toHaveLength(6);
      expect(dynModule.exports).toHaveLength(4);
    });

    it('readPaymentsConfig lee variables de entorno correctamente', () => {
      const config = readPaymentsConfig({
        envFile: null,
        environment: {
          PAYMENT_GATEWAY_PROVIDER: 'mock',
          PAYMENT_GATEWAY_WEBHOOK_SECRET: 'webhook_secret',
          MAX_PENDING_CASH_ORDERS: '5',
        },
      });
      expect(config.gatewayProvider).toBe('mock');
      expect(config.webhookSecret).toBe('webhook_secret');
      expect(config.maxPendingCashOrders).toBe(5);
    });
  });
});
