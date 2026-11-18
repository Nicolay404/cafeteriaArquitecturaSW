import type {
  CreatePaymentIntentDto,
  GatewayWebhookDto,
  PaymentIntentResultDto,
} from '../../../../../../packages/contracts/src/index.js';
import type { PaymentsConfig } from '../config.js';
import type { OutboxRepository } from '../repositories/outbox.repository.js';
import type { PaymentEntity, PaymentRepository } from '../repositories/payment.repository.js';
import { CircuitBreaker } from './gateway/circuit-breaker.js';
import type { PaymentGatewayPort } from './gateway/payment-gateway.port.js';

export class InvalidSignatureError extends Error {
  constructor(message = 'Firma de webhook de pasarela inválida') {
    super(message);
    this.name = 'InvalidSignatureError';
  }
}

export class DuplicatePaymentError extends Error {
  constructor(message = 'El pedido ya cuenta con un pago procesado o aprobado') {
    super(message);
    this.name = 'DuplicatePaymentError';
  }
}

export class CashLimitExceededError extends Error {
  constructor(message = 'El cliente ha superado el límite de pedidos en efectivo pendientes') {
    super(message);
    this.name = 'CashLimitExceededError';
  }
}

export class PaymentNotFoundError extends Error {
  constructor(message = 'Pago no encontrado') {
    super(message);
    this.name = 'PaymentNotFoundError';
  }
}

export class PaymentsService {
  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly outboxRepo: OutboxRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly config: PaymentsConfig,
    circuitBreaker?: CircuitBreaker,
  ) {
    this.circuitBreaker = circuitBreaker ?? new CircuitBreaker();
  }

  async createPaymentIntent(dto: CreatePaymentIntentDto): Promise<PaymentIntentResultDto> {
    if (dto.amountCents <= 0 || !Number.isInteger(dto.amountCents)) {
      throw new Error('El importe debe ser un entero positivo en centavos');
    }

    // Comprobación de idempotencia
    if (dto.idempotencyKey) {
      const existingKey = await this.paymentRepo.getIdempotencyKey(dto.idempotencyKey);
      if (existingKey) {
        return existingKey.responseBody as PaymentIntentResultDto;
      }
    }

    // Verificar si el pedido ya tiene un pago aprobado
    const existingPayment = await this.paymentRepo.findPaymentByOrderId(dto.orderId);
    if (existingPayment && existingPayment.status === 'approved') {
      throw new DuplicatePaymentError();
    }

    // Validar límite para pagos en efectivo
    if (dto.method === 'cash') {
      const pendingCash = await this.paymentRepo.countPendingCashOrdersByCustomer(dto.customerId);
      if (pendingCash >= this.config.maxPendingCashOrders) {
        throw new CashLimitExceededError();
      }
    }

    // Crear el registro de pago en estado pending
    const payment = await this.paymentRepo.createPayment({
      orderId: dto.orderId,
      customerId: dto.customerId,
      method: dto.method,
      amountCents: dto.amountCents,
      currency: dto.currency,
      idempotencyKey: dto.idempotencyKey,
    });

    let gatewaySession = null;
    if (dto.method === 'card') {
      gatewaySession = await this.circuitBreaker.execute(() =>
        this.gateway.createSession({
          orderId: dto.orderId,
          amountCents: dto.amountCents,
          currency: dto.currency,
          customerId: dto.customerId,
        }),
      );
    }

    const transferDetails =
      dto.method === 'transfer'
        ? {
            bankName: 'Banco Central de Prueba',
            accountType: 'Corriente',
            accountNumber: '1234567890',
            accountHolder: 'Cafetería Arquitectura S.A.',
            identification: '1790011223001',
            referenceCode: `REF-${payment.id.slice(0, 8).toUpperCase()}`,
          }
        : null;

    const result: PaymentIntentResultDto = {
      paymentId: payment.id,
      orderId: payment.orderId,
      customerId: payment.customerId,
      method: payment.method,
      status: payment.status,
      amountCents: payment.amountCents,
      currency: 'USD',
      gatewaySession,
      transferDetails,
      createdAt: payment.createdAt,
    };

    await this.paymentRepo.recordAuditLog({
      paymentId: payment.id,
      action: 'payment_intent_created',
      actorId: dto.customerId,
      actorRole: 'cliente',
      metadata: { method: dto.method, amountCents: dto.amountCents },
    });

    if (dto.idempotencyKey) {
      await this.paymentRepo.saveIdempotencyKey({
        key: dto.idempotencyKey,
        action: 'create_payment_intent',
        paymentId: payment.id,
        responseStatus: 201,
        responseBody: result,
      });
    }

    return result;
  }

  async handleGatewayWebhook(
    rawBody: string,
    signature: string,
    parsedPayload: unknown,
  ): Promise<{ received: boolean; paymentId?: string; status?: string }> {
    const isValid = this.gateway.verifyWebhookSignature(
      rawBody,
      signature,
      this.config.webhookSecret,
    );
    if (!isValid) {
      throw new InvalidSignatureError();
    }

    const webhookData: GatewayWebhookDto = this.gateway.parseWebhook(parsedPayload);

    // Deduplicación por eventId de la pasarela
    const existingEvent = await this.paymentRepo.getIdempotencyKey(webhookData.eventId);
    if (existingEvent) {
      return { received: true, ...(existingEvent.responseBody as Record<string, unknown>) };
    }

    // Localizar el pago por orderReference
    const payment = await this.paymentRepo.findPaymentByOrderId(webhookData.orderReference);
    if (!payment) {
      throw new PaymentNotFoundError(
        `No se encontró pago para el pedido ${webhookData.orderReference}`,
      );
    }

    if (payment.status === 'approved') {
      const resp = { received: true, paymentId: payment.id, status: 'approved' };
      await this.paymentRepo.saveIdempotencyKey({
        key: webhookData.eventId,
        action: 'gateway_webhook',
        paymentId: payment.id,
        responseStatus: 200,
        responseBody: resp,
      });
      return resp;
    }

    const targetStatus = webhookData.eventType === 'payment.succeeded' ? 'approved' : 'rejected';

    const updatedPayment = await this.paymentRepo.updatePaymentStatus(
      payment.id,
      'pending',
      targetStatus,
      {
        externalReference: webhookData.transactionId,
        failureReason: targetStatus === 'rejected' ? 'Pago rechazado por la pasarela' : null,
      },
    );

    if (!updatedPayment) {
      return { received: true, paymentId: payment.id, status: payment.status };
    }

    // Publicación atómica en Outbox
    if (targetStatus === 'approved') {
      await this.outboxRepo.saveEvent('pago.confirmado', updatedPayment.id, {
        paymentId: updatedPayment.id,
        orderId: updatedPayment.orderId,
        customerId: updatedPayment.customerId,
        method: 'card',
        amountCents: updatedPayment.amountCents,
        currency: 'USD',
        confirmedAt: new Date().toISOString(),
      });
    } else {
      await this.outboxRepo.saveEvent('pago.rechazado', updatedPayment.id, {
        paymentId: updatedPayment.id,
        orderId: updatedPayment.orderId,
        customerId: updatedPayment.customerId,
        method: 'card',
        reason: 'Pago rechazado por la pasarela',
        rejectedAt: new Date().toISOString(),
      });
    }

    await this.paymentRepo.recordAuditLog({
      paymentId: updatedPayment.id,
      action: targetStatus === 'approved' ? 'card_payment_approved' : 'card_payment_rejected',
      actorId: '00000000-0000-0000-0000-000000000000',
      actorRole: 'gateway_webhook',
      metadata: { transactionId: webhookData.transactionId, eventId: webhookData.eventId },
    });

    const response = {
      received: true,
      paymentId: updatedPayment.id,
      status: updatedPayment.status,
    };

    await this.paymentRepo.saveIdempotencyKey({
      key: webhookData.eventId,
      action: 'gateway_webhook',
      paymentId: updatedPayment.id,
      responseStatus: 200,
      responseBody: response,
    });

    return response;
  }

  async getPaymentById(id: string): Promise<PaymentEntity | null> {
    return this.paymentRepo.findPaymentById(id);
  }
}
