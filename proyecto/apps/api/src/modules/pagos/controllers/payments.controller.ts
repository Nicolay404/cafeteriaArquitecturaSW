import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  CollectCashDto,
  CreatePaymentIntentDto,
  RequestRefundDto,
  UploadTransferReceiptDto,
  VerifyTransferDto,
} from '../../../../../../packages/contracts/src/index.js';
import {
  CashLimitExceededError,
  DuplicatePaymentError,
  PaymentNotFoundError,
  PaymentsService,
} from '../services/payments.service.js';
import {
  CashPaymentService,
  InsufficientAmountReceivedError,
  InvalidPaymentStateError,
} from '../services/cash-payment.service.js';
import {
  PayloadTooLargeError,
  ReceiptNotFoundError,
  TransferService,
  UnsupportedMediaTypeError,
} from '../services/transfer.service.js';
import {
  InvalidRefundAmountError,
  PaymentNotRefundableError,
  RefundService,
} from '../services/refund.service.js';

@Controller('api/payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(CashPaymentService) private readonly cashService: CashPaymentService,
    @Inject(TransferService) private readonly transferService: TransferService,
    @Inject(RefundService) private readonly refundService: RefundService,
  ) {}

  @Post('intent')
  @HttpCode(201)
  async createIntent(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: Omit<CreatePaymentIntentDto, 'idempotencyKey'>,
  ) {
    try {
      return await this.paymentsService.createPaymentIntent({
        ...body,
        idempotencyKey: idempotencyKey ?? '',
      });
    } catch (error) {
      if (error instanceof CashLimitExceededError) {
        throw new UnprocessableEntityException(error.message);
      }
      if (error instanceof DuplicatePaymentError) {
        throw new BadRequestException(error.message);
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error al crear intento de pago',
      );
    }
  }

  @Get(':paymentId')
  async getPayment(@Param('paymentId') paymentId: string) {
    const payment = await this.paymentsService.getPaymentById(paymentId);
    if (!payment) {
      throw new NotFoundException('Pago no encontrado');
    }
    return payment;
  }

  @Post(':paymentId/collect-cash')
  @HttpCode(200)
  async collectCash(@Param('paymentId') paymentId: string, @Body() dto: CollectCashDto) {
    try {
      return await this.cashService.collectCash(paymentId, dto);
    } catch (error) {
      if (error instanceof PaymentNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (
        error instanceof InsufficientAmountReceivedError ||
        error instanceof InvalidPaymentStateError
      ) {
        throw new BadRequestException(error.message);
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error al registrar cobro',
      );
    }
  }

  @Post(':paymentId/receipt')
  @HttpCode(201)
  async uploadReceipt(
    @Param('paymentId') paymentId: string,
    @Body() file: UploadTransferReceiptDto,
  ) {
    try {
      return await this.transferService.uploadReceipt(paymentId, file);
    } catch (error) {
      if (error instanceof PaymentNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof PayloadTooLargeError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof UnsupportedMediaTypeError) {
        throw new BadRequestException(error.message);
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error al subir comprobante',
      );
    }
  }

  @Post(':paymentId/verify-transfer')
  @HttpCode(200)
  async verifyTransfer(@Param('paymentId') paymentId: string, @Body() dto: VerifyTransferDto) {
    try {
      return await this.transferService.verifyTransfer(paymentId, dto);
    } catch (error) {
      if (error instanceof PaymentNotFoundError || error instanceof ReceiptNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error al verificar transferencia',
      );
    }
  }

  @Post(':paymentId/refund')
  @HttpCode(200)
  async requestRefund(
    @Param('paymentId') paymentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: Omit<RequestRefundDto, 'idempotencyKey'>,
  ) {
    try {
      return await this.refundService.requestRefund(paymentId, {
        ...dto,
        idempotencyKey: idempotencyKey ?? '',
      });
    } catch (error) {
      if (error instanceof PaymentNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof PaymentNotRefundableError || error instanceof InvalidRefundAmountError) {
        throw new BadRequestException(error.message);
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error al procesar reembolso',
      );
    }
  }
}
