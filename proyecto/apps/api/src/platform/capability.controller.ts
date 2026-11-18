import { Controller, Get, Header, Inject, NotFoundException } from '@nestjs/common';
import { FlagsService } from './flags.service.js';

// Capacidad técnica mínima para demostrar US4.3: con el flag apagado la ruta no existe para
// quien la consulta (404) y no se revela su nombre ni su estado. No es una función de negocio.
@Controller('platform')
export class CapabilityController {
  constructor(@Inject(FlagsService) private readonly flags: FlagsService) {}

  @Get('capacidad-prueba')
  @Header('Cache-Control', 'no-store')
  async capability() {
    if (!(await this.flags.isEnabled('capacidad-tecnica-de-prueba'))) throw new NotFoundException();
    return { capacidad: 'prueba-tecnica', habilitada: true };
  }
}
