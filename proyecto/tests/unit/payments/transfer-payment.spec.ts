import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  TransferService,
  UnsupportedMediaTypeError,
  PayloadTooLargeError,
  ReceiptNotFoundError,
} from '../../../apps/api/src/modules/pagos/services/transfer.service.js';
import type {
  PaymentEntity,
  PaymentRepository,
  TransferReceiptEntity,
} from '../../../apps/api/src/modules/pagos/repositories/payment.repository.js';
import type { OutboxRepository } from '../../../apps/api/src/modules/pagos/repositories/outbox.repository.js';

describe('US3: Pagar por transferencia (Unit Tests - TDD)', () => {
  let mockPaymentRepo: { [K in keyof PaymentRepository]: ReturnType<typeof vi.fn> };
  let mockOutboxRepo: { [K in keyof OutboxRepository]: ReturnType<typeof vi.fn> };
  let service: TransferService;

  beforeEach(() => {
    mockPaymentRepo = {
      findPaymentById: vi.fn(),
      saveTransferReceipt: vi.fn().mockImplementation((data) =>
        Promise.resolve({
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
        } as TransferReceiptEntity),
      ),
      findTransferReceiptByPaymentId: vi.fn(),
      updateTransferReceiptStatus: vi.fn().mockResolvedValue(undefined),
      updatePaymentStatus: vi.fn().mockImplementation((id, current, next, opts) =>
        Promise.resolve({
          id,
          orderId: 'order-trf-1',
          customerId: 'cust-trf-1',
          method: 'transfer',
          status: next,
          amountCents: 2500,
          currency: 'USD',
          externalReference: opts?.externalReference ?? null,
          idempotencyKey: null,
          failureReason: opts?.failureReason ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as PaymentEntity),
      ),
      recordAuditLog: vi.fn().mockResolvedValue(undefined),
    } as unknown as { [K in keyof PaymentRepository]: ReturnType<typeof vi.fn> };

    mockOutboxRepo = {
      saveEvent: vi.fn().mockResolvedValue('outbox-trf-1'),
    } as unknown as { [K in keyof OutboxRepository]: ReturnType<typeof vi.fn> };

    service = new TransferService(
      mockPaymentRepo as unknown as PaymentRepository,
      mockOutboxRepo as unknown as OutboxRepository,
    );
  });

  describe('Subida de comprobante de transferencia', () => {
    it('acepta un comprobante válido y establece la fecha de retención LOPDP de 90 días', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf-1',
        orderId: 'order-trf-1',
        customerId: 'cust-1',
        method: 'transfer',
        status: 'pending',
      });

      const result = await service.uploadReceipt('pay-trf-1', {
        fileName: 'safe-uuid-name.png',
        originalName: 'comprobante_banco.png',
        mimeType: 'image/png',
        fileSizeBytes: 1024 * 500, // 500 KB
      });

      expect(result.receiptId).toBe('rec-uuid-1');
      expect(result.status).toBe('pending_verification');
      expect(result.retentionUntil).toBeDefined();

      const retentionDays =
        (new Date(result.retentionUntil).getTime() - Date.now()) / (1000 * 3600 * 24);
      expect(Math.round(retentionDays)).toBe(90);

      expect(mockPaymentRepo.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'transfer_receipt_uploaded',
          actorRole: 'cliente',
        }),
      );
    });

    it('rechaza tipos MIME no soportados (ej. ejecutables o texto plano)', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf-2',
        method: 'transfer',
      });

      await expect(
        service.uploadReceipt('pay-trf-2', {
          fileName: 'malicious.exe',
          originalName: 'malicious.exe',
          mimeType: 'application/x-msdownload',
          fileSizeBytes: 2000,
        }),
      ).rejects.toThrow(UnsupportedMediaTypeError);
    });

    it('rechaza archivos que superan el límite de 5 MB', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf-3',
        method: 'transfer',
      });

      await expect(
        service.uploadReceipt('pay-trf-3', {
          fileName: 'large.pdf',
          originalName: 'large.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 6 * 1024 * 1024, // 6 MB
        }),
      ).rejects.toThrow(PayloadTooLargeError);
    });
  });

  describe('Verificación de transferencia por el personal', () => {
    it('aprueba la transferencia, pasa el pedido a approved y emite pago.confirmado', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf-4',
        orderId: 'order-trf-4',
        customerId: 'cust-4',
        method: 'transfer',
        status: 'pending',
        amountCents: 2500,
      });

      mockPaymentRepo.findTransferReceiptByPaymentId.mockResolvedValueOnce({
        id: 'rec-trf-4',
        paymentId: 'pay-trf-4',
        status: 'pending_verification',
      });

      const result = await service.verifyTransfer('pay-trf-4', {
        action: 'approve',
        staffUserId: 'staff-validator-1',
        notes: 'Verificado saldo en cuenta bancaria',
      });

      expect(result.status).toBe('approved');
      expect(result.verifiedBy).toBe('staff-validator-1');
      expect(mockPaymentRepo.updateTransferReceiptStatus).toHaveBeenCalledWith(
        'rec-trf-4',
        'verified',
        'staff-validator-1',
        undefined,
      );
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.confirmado',
        'pay-trf-4',
        expect.objectContaining({
          method: 'transfer',
          amountCents: 2500,
        }),
      );
    });

    it('rechaza la transferencia con motivo obligatorio, pasa a rejected y emite pago.rechazado', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf-5',
        orderId: 'order-trf-5',
        customerId: 'cust-5',
        method: 'transfer',
        status: 'pending',
        amountCents: 2500,
      });

      mockPaymentRepo.findTransferReceiptByPaymentId.mockResolvedValueOnce({
        id: 'rec-trf-5',
        paymentId: 'pay-trf-5',
        status: 'pending_verification',
      });

      const result = await service.verifyTransfer('pay-trf-5', {
        action: 'reject',
        staffUserId: 'staff-validator-1',
        rejectionReason: 'Número de cuenta o importe no coinciden con la transacción bancaria',
      });

      expect(result.status).toBe('rejected');
      expect(result.rejectionReason).toContain('no coinciden');
      expect(mockPaymentRepo.updateTransferReceiptStatus).toHaveBeenCalledWith(
        'rec-trf-5',
        'rejected',
        'staff-validator-1',
        'Número de cuenta o importe no coinciden con la transacción bancaria',
      );
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalledWith(
        'pago.rechazado',
        'pay-trf-5',
        expect.objectContaining({
          method: 'transfer',
          reason: expect.stringContaining('no coinciden'),
        }),
      );
    });

    it('exige motivo explicativo cuando se rechaza una transferencia', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf-6',
        method: 'transfer',
      });
      mockPaymentRepo.findTransferReceiptByPaymentId.mockResolvedValueOnce({
        id: 'rec-trf-6',
      });

      await expect(
        service.verifyTransfer('pay-trf-6', {
          action: 'reject',
          staffUserId: 'staff-1',
          rejectionReason: '',
        }),
      ).rejects.toThrow('Se requiere un motivo explicativo para rechazar la transferencia');
    });

    it('falla si no existe comprobante asociado', async () => {
      mockPaymentRepo.findPaymentById.mockResolvedValueOnce({
        id: 'pay-trf-7',
        method: 'transfer',
      });
      mockPaymentRepo.findTransferReceiptByPaymentId.mockResolvedValueOnce(null);

      await expect(
        service.verifyTransfer('pay-trf-7', {
          action: 'approve',
          staffUserId: 'staff-1',
        }),
      ).rejects.toThrow(ReceiptNotFoundError);
    });
  });
});
