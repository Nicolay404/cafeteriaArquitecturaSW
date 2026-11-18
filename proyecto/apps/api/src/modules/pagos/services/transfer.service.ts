import type {
  TransferReceiptResultDto,
  UploadTransferReceiptDto,
  VerifyTransferDto,
  VerifyTransferResultDto,
} from '../../../../../../packages/contracts/src/index.js';
import type { OutboxRepository } from '../repositories/outbox.repository.js';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import { PaymentNotFoundError } from './payments.service.js';

export class UnsupportedMediaTypeError extends Error {
  constructor(message = 'Formato de comprobante no soportado. Solo se admiten JPG, PNG y PDF') {
    super(message);
    this.name = 'UnsupportedMediaTypeError';
  }
}

export class PayloadTooLargeError extends Error {
  constructor(message = 'El archivo supera el tamaño máximo permitido de 5 MB') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

export class ReceiptNotFoundError extends Error {
  constructor(message = 'No se encontró comprobante asociado a este pago') {
    super(message);
    this.name = 'ReceiptNotFoundError';
  }
}

export class TransferService {
  private readonly maxFileSizeBytes = 5 * 1024 * 1024; // 5 MB
  private readonly allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];

  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly outboxRepo: OutboxRepository,
  ) {}

  async uploadReceipt(
    paymentId: string,
    file: UploadTransferReceiptDto,
  ): Promise<TransferReceiptResultDto> {
    const payment = await this.paymentRepo.findPaymentById(paymentId);
    if (!payment) {
      throw new PaymentNotFoundError();
    }

    if (payment.method !== 'transfer') {
      throw new Error('El pago indicado no corresponde al método de transferencia');
    }

    if (file.fileSizeBytes > this.maxFileSizeBytes) {
      throw new PayloadTooLargeError();
    }

    if (!this.allowedMimeTypes.includes(file.mimeType.toLowerCase())) {
      throw new UnsupportedMediaTypeError();
    }

    const receipt = await this.paymentRepo.saveTransferReceipt({
      paymentId,
      fileName: file.fileName,
      originalName: file.originalName,
      mimeType: file.mimeType,
      fileSizeBytes: file.fileSizeBytes,
    });

    await this.paymentRepo.recordAuditLog({
      paymentId,
      action: 'transfer_receipt_uploaded',
      actorId: payment.customerId,
      actorRole: 'cliente',
      metadata: { receiptId: receipt.id, fileName: file.fileName },
    });

    return {
      receiptId: receipt.id,
      paymentId: receipt.paymentId,
      fileName: receipt.fileName,
      status: receipt.status,
      retentionUntil: receipt.retentionUntil,
      uploadedAt: receipt.createdAt,
    };
  }

  async verifyTransfer(
    paymentId: string,
    dto: VerifyTransferDto,
  ): Promise<VerifyTransferResultDto> {
    const payment = await this.paymentRepo.findPaymentById(paymentId);
    if (!payment) {
      throw new PaymentNotFoundError();
    }

    const receipt = await this.paymentRepo.findTransferReceiptByPaymentId(paymentId);
    if (!receipt) {
      throw new ReceiptNotFoundError();
    }

    if (dto.action === 'reject' && !dto.rejectionReason?.trim()) {
      throw new Error('Se requiere un motivo explicativo para rechazar la transferencia');
    }

    const receiptStatus = dto.action === 'approve' ? 'verified' : 'rejected';
    const paymentStatus = dto.action === 'approve' ? 'approved' : 'rejected';

    await this.paymentRepo.updateTransferReceiptStatus(
      receipt.id,
      receiptStatus,
      dto.staffUserId,
      dto.rejectionReason,
    );

    const updatedPayment = await this.paymentRepo.updatePaymentStatus(
      payment.id,
      payment.status,
      paymentStatus,
      {
        externalReference: `TRF-${receipt.id.slice(0, 8)}`,
        failureReason: dto.action === 'reject' ? (dto.rejectionReason ?? null) : null,
      },
    );

    const targetPayment = updatedPayment ?? payment;

    if (dto.action === 'approve') {
      await this.outboxRepo.saveEvent('pago.confirmado', targetPayment.id, {
        paymentId: targetPayment.id,
        orderId: targetPayment.orderId,
        customerId: targetPayment.customerId,
        method: 'transfer',
        amountCents: targetPayment.amountCents,
        currency: 'USD',
        confirmedAt: new Date().toISOString(),
      });
    } else {
      await this.outboxRepo.saveEvent('pago.rechazado', targetPayment.id, {
        paymentId: targetPayment.id,
        orderId: targetPayment.orderId,
        customerId: targetPayment.customerId,
        method: 'transfer',
        reason: dto.rejectionReason ?? 'Comprobante no válido',
        rejectedAt: new Date().toISOString(),
      });
    }

    await this.paymentRepo.recordAuditLog({
      paymentId: targetPayment.id,
      action:
        dto.action === 'approve' ? 'transfer_verified_approved' : 'transfer_verified_rejected',
      actorId: dto.staffUserId,
      actorRole: 'personal',
      metadata: { notes: dto.notes, reason: dto.rejectionReason },
    });

    return {
      paymentId: targetPayment.id,
      orderId: targetPayment.orderId,
      status: paymentStatus,
      verifiedBy: dto.staffUserId,
      verifiedAt: new Date().toISOString(),
      rejectionReason: dto.action === 'reject' ? (dto.rejectionReason ?? null) : null,
    };
  }
}
