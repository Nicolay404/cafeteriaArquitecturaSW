import type {
  CollectCashDto,
  CollectCashResultDto,
} from '../../../../../../packages/contracts/src/index.js';
import type { PaymentsConfig } from '../config.js';
import type { OutboxRepository } from '../repositories/outbox.repository.js';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import { CashLimitExceededError, PaymentNotFoundError } from './payments.service.js';

export class InsufficientAmountReceivedError extends Error {
  constructor(message = 'El importe recibido en efectivo es menor al total del pedido') {
    super(message);
    this.name = 'InsufficientAmountReceivedError';
  }
}

export class InvalidPaymentStateError extends Error {
  constructor(message = 'El pago no se encuentra en estado pendiente para cobro en efectivo') {
    super(message);
    this.name = 'InvalidPaymentStateError';
  }
}

export class CashPaymentService {
  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly outboxRepo: OutboxRepository,
    private readonly config: PaymentsConfig,
  ) {}

  async validateCanPayCash(customerId: string): Promise<void> {
    const pendingCount = await this.paymentRepo.countPendingCashOrdersByCustomer(customerId);
    if (pendingCount >= this.config.maxPendingCashOrders) {
      throw new CashLimitExceededError();
    }
  }

  async collectCash(paymentId: string, dto: CollectCashDto): Promise<CollectCashResultDto> {
    const payment = await this.paymentRepo.findPaymentById(paymentId);
    if (!payment) {
      throw new PaymentNotFoundError();
    }

    if (payment.method !== 'cash') {
      throw new Error('El método de pago de este pedido no es efectivo');
    }

    if (payment.status !== 'pending') {
      throw new InvalidPaymentStateError();
    }

    if (dto.amountReceivedCents < payment.amountCents) {
      throw new InsufficientAmountReceivedError();
    }

    const changeCents = dto.amountReceivedCents - payment.amountCents;

    const updated = await this.paymentRepo.updatePaymentStatus(payment.id, 'pending', 'approved', {
      externalReference: `CASH-DESK-${payment.id.slice(0, 8)}`,
    });

    if (!updated) {
      throw new InvalidPaymentStateError('No se pudo actualizar el estado del pago');
    }

    // Publicar evento en Outbox
    await this.outboxRepo.saveEvent('pago.confirmado', updated.id, {
      paymentId: updated.id,
      orderId: updated.orderId,
      customerId: updated.customerId,
      method: 'cash',
      amountCents: updated.amountCents,
      amountReceivedCents: dto.amountReceivedCents,
      changeCents,
      currency: 'USD',
      confirmedAt: new Date().toISOString(),
    });

    await this.paymentRepo.recordAuditLog({
      paymentId: updated.id,
      action: 'cash_payment_collected',
      actorId: dto.staffUserId,
      actorRole: 'personal',
      metadata: {
        amountCents: updated.amountCents,
        amountReceivedCents: dto.amountReceivedCents,
        changeCents,
      },
    });

    return {
      paymentId: updated.id,
      orderId: updated.orderId,
      status: updated.status,
      amountCents: updated.amountCents,
      amountReceivedCents: dto.amountReceivedCents,
      changeCents,
      collectedBy: dto.staffUserId,
      collectedAt: new Date().toISOString(),
    };
  }
}
