import type { PaymentMethod } from './payment.dto.js';

export interface PagoConfirmadoEvent {
  readonly eventName: 'pago.confirmado';
  readonly eventId: string;
  readonly aggregateType: 'payment';
  readonly aggregateId: string;
  readonly timestamp: string;
  readonly version: 1;
  readonly payload: {
    readonly paymentId: string;
    readonly orderId: string;
    readonly customerId: string;
    readonly method: PaymentMethod;
    readonly amountCents: number;
    readonly currency: 'USD';
    readonly confirmedAt: string;
  };
}

export interface PagoRechazadoEvent {
  readonly eventName: 'pago.rechazado';
  readonly eventId: string;
  readonly aggregateType: 'payment';
  readonly aggregateId: string;
  readonly timestamp: string;
  readonly version: 1;
  readonly payload: {
    readonly paymentId: string;
    readonly orderId: string;
    readonly customerId: string;
    readonly method: PaymentMethod;
    readonly reason: string;
    readonly rejectedAt: string;
  };
}

export interface PagoReembolsadoEvent {
  readonly eventName: 'pago.reembolsado';
  readonly eventId: string;
  readonly aggregateType: 'payment';
  readonly aggregateId: string;
  readonly timestamp: string;
  readonly version: 1;
  readonly payload: {
    readonly paymentId: string;
    readonly refundId: string;
    readonly orderId: string;
    readonly amountCents: number;
    readonly method: string;
    readonly refundedAt: string;
  };
}

export type PaymentDomainEvent = PagoConfirmadoEvent | PagoRechazadoEvent | PagoReembolsadoEvent;
