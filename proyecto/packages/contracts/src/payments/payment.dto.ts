export type PaymentMethod = 'card' | 'transfer' | 'cash';

export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'refunded';

export type ReceiptStatus = 'pending_verification' | 'verified' | 'rejected';

export interface CreatePaymentIntentDto {
  readonly orderId: string;
  readonly customerId: string;
  readonly method: PaymentMethod;
  readonly amountCents: number;
  readonly currency: 'USD';
  readonly idempotencyKey: string;
}

export interface BankTransferInfo {
  readonly bankName: string;
  readonly accountType: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
  readonly identification: string;
  readonly referenceCode: string;
}

export interface GatewaySessionInfo {
  readonly sessionId: string;
  readonly redirectUrl: string;
}

export interface PaymentIntentResultDto {
  readonly paymentId: string;
  readonly orderId: string;
  readonly customerId: string;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly amountCents: number;
  readonly currency: 'USD';
  readonly gatewaySession?: GatewaySessionInfo | null;
  readonly transferDetails?: BankTransferInfo | null;
  readonly createdAt: string;
}

export interface GatewayWebhookDto {
  readonly eventId: string;
  readonly eventType: 'payment.succeeded' | 'payment.failed';
  readonly transactionId: string;
  readonly orderReference: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly signature: string;
  readonly timestamp: string;
}

export interface CollectCashDto {
  readonly amountReceivedCents: number;
  readonly staffUserId: string;
}

export interface CollectCashResultDto {
  readonly paymentId: string;
  readonly orderId: string;
  readonly status: PaymentStatus;
  readonly amountCents: number;
  readonly amountReceivedCents: number;
  readonly changeCents: number;
  readonly collectedBy: string;
  readonly collectedAt: string;
}

export interface VerifyTransferDto {
  readonly action: 'approve' | 'reject';
  readonly staffUserId: string;
  readonly notes?: string;
  readonly rejectionReason?: string;
}

export interface VerifyTransferResultDto {
  readonly paymentId: string;
  readonly orderId: string;
  readonly status: PaymentStatus;
  readonly verifiedBy: string;
  readonly verifiedAt: string;
  readonly rejectionReason?: string | null;
}

export interface UploadTransferReceiptDto {
  readonly fileName: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
}

export interface TransferReceiptResultDto {
  readonly receiptId: string;
  readonly paymentId: string;
  readonly fileName: string;
  readonly status: ReceiptStatus;
  readonly retentionUntil: string;
  readonly uploadedAt: string;
}

export interface RequestRefundDto {
  readonly amountCents: number;
  readonly reason: string;
  readonly requestedBy: string;
  readonly idempotencyKey: string;
}

export interface RefundResultDto {
  readonly refundId: string;
  readonly paymentId: string;
  readonly amountCents: number;
  readonly status: 'completed' | 'pending' | 'failed';
  readonly method: 'card_gateway' | 'manual_transfer' | 'cash_desk';
  readonly reason: string;
  readonly createdAt: string;
  readonly completedAt?: string | null;
}
