import type {
  RefundResultDto,
  RequestRefundDto,
} from '../../../../../../packages/contracts/src/index.js';
import type { OutboxRepository } from '../repositories/outbox.repository.js';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { PaymentGatewayPort } from './gateway/payment-gateway.port.js';
import { PaymentNotFoundError } from './payments.service.js';

export class InvalidRefundAmountError extends Error {
  constructor(message = 'El importe del reembolso excede el total pagado o es inválido') {
    super(message);
    this.name = 'InvalidRefundAmountError';
  }
}

export class PaymentNotRefundableError extends Error {
  constructor(message = 'Solo se pueden reembolsar pagos aprobados') {
    super(message);
    this.name = 'PaymentNotRefundableError';
  }
}

export class RefundService {
  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly outboxRepo: OutboxRepository,
    private readonly gateway: PaymentGatewayPort,
  ) {}

  async requestRefund(paymentId: string, dto: RequestRefundDto): Promise<RefundResultDto> {
    if (dto.idempotencyKey) {
      const existing = await this.paymentRepo.getIdempotencyKey(dto.idempotencyKey);
      if (existing) {
        return existing.responseBody as RefundResultDto;
      }
    }

    const payment = await this.paymentRepo.findPaymentById(paymentId);
    if (!payment) {
      throw new PaymentNotFoundError();
    }

    if (payment.status !== 'approved') {
      throw new PaymentNotRefundableError();
    }

    if (dto.amountCents <= 0 || dto.amountCents > payment.amountCents) {
      throw new InvalidRefundAmountError();
    }

    let refundMethod: 'card_gateway' | 'manual_transfer' | 'cash_desk';
    let refundStatus: 'completed' | 'pending' | 'failed' = 'completed';
    let externalRefundId: string | null = null;

    if (payment.method === 'card') {
      refundMethod = 'card_gateway';
      const gwResult = await this.gateway.processRefund(
        payment.externalReference ?? payment.id,
        dto.amountCents,
        dto.reason,
      );
      externalRefundId = gwResult.refundId;
      refundStatus = gwResult.status;
    } else if (payment.method === 'transfer') {
      refundMethod = 'manual_transfer';
      refundStatus = 'pending'; // Tarea para el personal contable
    } else {
      refundMethod = 'cash_desk';
      refundStatus = 'completed';
    }

    const refund = await this.paymentRepo.createRefund({
      paymentId: payment.id,
      amountCents: dto.amountCents,
      method: refundMethod,
      reason: dto.reason,
      requestedBy: dto.requestedBy,
      externalRefundId,
      status: refundStatus,
    });

    await this.paymentRepo.updatePaymentStatus(payment.id, 'approved', 'refunded');

    await this.outboxRepo.saveEvent('pago.reembolsado', payment.id, {
      paymentId: payment.id,
      refundId: refund.id,
      orderId: payment.orderId,
      amountCents: dto.amountCents,
      method: refundMethod,
      refundedAt: new Date().toISOString(),
    });

    await this.paymentRepo.recordAuditLog({
      paymentId: payment.id,
      action: 'payment_refund_processed',
      actorId: dto.requestedBy,
      actorRole: 'admin',
      metadata: {
        refundId: refund.id,
        amountCents: dto.amountCents,
        method: refundMethod,
        reason: dto.reason,
      },
    });

    const result: RefundResultDto = {
      refundId: refund.id,
      paymentId: payment.id,
      amountCents: refund.amountCents,
      status: refund.status,
      method: refund.method,
      reason: refund.reason,
      createdAt: refund.createdAt,
      completedAt: refund.completedAt,
    };

    if (dto.idempotencyKey) {
      await this.paymentRepo.saveIdempotencyKey({
        key: dto.idempotencyKey,
        action: 'request_refund',
        paymentId: payment.id,
        responseStatus: 200,
        responseBody: result,
      });
    }

    return result;
  }
}
