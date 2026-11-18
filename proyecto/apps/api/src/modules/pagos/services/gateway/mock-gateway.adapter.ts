import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GatewayWebhookDto } from '../../../../../../../packages/contracts/src/index.js';
import type {
  CreateSessionParams,
  GatewayPaymentStatusResult,
  GatewayRefundResult,
  GatewaySessionResult,
  PaymentGatewayPort,
} from './payment-gateway.port.js';

export class MockPaymentGatewayAdapter implements PaymentGatewayPort {
  private readonly transactions = new Map<
    string,
    { status: 'approved' | 'rejected'; amountCents: number }
  >();

  async createSession(params: CreateSessionParams): Promise<GatewaySessionResult> {
    const sessionId = `mock_sess_${params.orderId.replace(/-/g, '').slice(0, 16)}`;
    const redirectUrl = `https://gateway-sandbox.example.com/checkout?session=${sessionId}`;
    return { sessionId, redirectUrl };
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    if (!signature || !secret) return false;
    try {
      const computed = createHmac('sha256', secret).update(payload).digest('hex');
      const sigBuf = Buffer.from(signature, 'hex');
      const compBuf = Buffer.from(computed, 'hex');
      if (sigBuf.length !== compBuf.length) return false;
      return timingSafeEqual(sigBuf, compBuf);
    } catch {
      return false;
    }
  }

  generateSignature(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  parseWebhook(payload: unknown): GatewayWebhookDto {
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Cuerpo de webhook inválido: no es un objeto');
    }
    const data = payload as Record<string, unknown>;
    const eventId = String(data['eventId'] ?? '');
    const eventType =
      data['eventType'] === 'payment.succeeded' ? 'payment.succeeded' : 'payment.failed';
    const transactionId = String(data['transactionId'] ?? '');
    const orderReference = String(data['orderReference'] ?? '');
    const amountCents = Number(data['amountCents'] ?? 0);
    const currency = String(data['currency'] ?? 'USD');
    const signature = String(data['signature'] ?? '');
    const timestamp = String(data['timestamp'] ?? new Date().toISOString());

    if (!eventId || !transactionId || !orderReference || amountCents <= 0) {
      throw new Error('Campos obligatorios ausentes en el webhook');
    }

    this.transactions.set(transactionId, {
      status: eventType === 'payment.succeeded' ? 'approved' : 'rejected',
      amountCents,
    });

    return {
      eventId,
      eventType,
      transactionId,
      orderReference,
      amountCents,
      currency,
      signature,
      timestamp,
    };
  }

  async queryPaymentStatus(transactionId: string): Promise<GatewayPaymentStatusResult> {
    const tx = this.transactions.get(transactionId);
    if (!tx) {
      return { transactionId, status: 'pending', amountCents: 0 };
    }
    return { transactionId, status: tx.status, amountCents: tx.amountCents };
  }

  async processRefund(
    transactionId: string,
    amountCents: number,
    reason: string,
  ): Promise<GatewayRefundResult> {
    void transactionId;
    void amountCents;
    void reason;
    const refundId = `mock_ref_${Date.now()}`;
    return { refundId, status: 'completed' };
  }
}
