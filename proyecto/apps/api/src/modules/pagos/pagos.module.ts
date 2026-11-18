import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { PaymentsController } from './controllers/payments.controller.js';
import { WebhookController } from './controllers/webhook.controller.js';
import { PaymentsService } from './services/payments.service.js';
import { CashPaymentService } from './services/cash-payment.service.js';
import { TransferService } from './services/transfer.service.js';
import { RefundService } from './services/refund.service.js';
import { PaymentRepository } from './repositories/payment.repository.js';
import type { DbClient } from './repositories/payment.repository.js';
import { OutboxRepository } from './repositories/outbox.repository.js';
import { MockPaymentGatewayAdapter } from './services/gateway/mock-gateway.adapter.js';
import type { PaymentsConfig } from './config.js';
import { readPaymentsConfig } from './config.js';

export interface PagosModuleOptions {
  db: DbClient;
  config?: PaymentsConfig;
}

@Module({
  controllers: [PaymentsController, WebhookController],
  providers: [
    PaymentsService,
    CashPaymentService,
    TransferService,
    RefundService,
    PaymentRepository,
    OutboxRepository,
  ],
  exports: [PaymentsService, CashPaymentService, TransferService, RefundService],
})
export class PagosModule {
  static register(options: PagosModuleOptions): DynamicModule {
    const config = options.config ?? readPaymentsConfig();
    const gateway = new MockPaymentGatewayAdapter();
    const paymentRepo = new PaymentRepository(options.db);
    const outboxRepo = new OutboxRepository(options.db);
    const paymentsService = new PaymentsService(paymentRepo, outboxRepo, gateway, config);
    const cashService = new CashPaymentService(paymentRepo, outboxRepo, config);
    const transferService = new TransferService(paymentRepo, outboxRepo);
    const refundService = new RefundService(paymentRepo, outboxRepo, gateway);

    return {
      module: PagosModule,
      controllers: [PaymentsController, WebhookController],
      providers: [
        { provide: PaymentRepository, useValue: paymentRepo },
        { provide: OutboxRepository, useValue: outboxRepo },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: CashPaymentService, useValue: cashService },
        { provide: TransferService, useValue: transferService },
        { provide: RefundService, useValue: refundService },
      ],
      exports: [PaymentsService, CashPaymentService, TransferService, RefundService],
    };
  }
}
