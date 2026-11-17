import { Controller, Get, Header, HttpException, Inject } from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async readiness() {
    const available = await this.health.ready();
    const body = { status: available ? 'ok' : 'unavailable', version: this.health.version };
    if (!available) throw new HttpException(body, 503);
    return body;
  }

  @Get('live')
  @Header('Cache-Control', 'no-store')
  liveness() {
    return { status: 'ok', version: this.health.version };
  }
}
