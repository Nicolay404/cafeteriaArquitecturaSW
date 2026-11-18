import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { InvalidSignatureError, PaymentsService } from '../services/payments.service.js';

@Controller('api/payments/webhook')
export class WebhookController {
  constructor(@Inject(PaymentsService) private readonly paymentsService: PaymentsService) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-gateway-signature') signature: string | undefined,
    @Body() payload: unknown,
  ) {
    if (!signature) {
      throw new UnauthorizedException('Encabezado de firma x-gateway-signature ausente');
    }

    try {
      const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return await this.paymentsService.handleGatewayWebhook(rawBody, signature, payload);
    } catch (error) {
      if (error instanceof InvalidSignatureError) {
        throw new UnauthorizedException(error.message);
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error al procesar el webhook',
      );
    }
  }
}
