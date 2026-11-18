import type { GatewayWebhookDto } from '../../../../../../../packages/contracts/src/index.js';

export interface CreateSessionParams {
  readonly orderId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly customerId: string;
}

export interface GatewaySessionResult {
  readonly sessionId: string;
  readonly redirectUrl: string;
}

export interface GatewayPaymentStatusResult {
  readonly transactionId: string;
  readonly status: 'approved' | 'rejected' | 'pending';
  readonly amountCents: number;
}

export interface GatewayRefundResult {
  readonly refundId: string;
  readonly status: 'completed' | 'failed';
}

export interface PaymentGatewayPort {
  createSession(params: CreateSessionParams): Promise<GatewaySessionResult>;
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
  parseWebhook(payload: unknown): GatewayWebhookDto;
  queryPaymentStatus(transactionId: string): Promise<GatewayPaymentStatusResult>;
  processRefund(
    transactionId: string,
    amountCents: number,
    reason: string,
  ): Promise<GatewayRefundResult>;
}
