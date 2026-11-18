import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ActorRole,
  OperationalConfigDto,
} from '../../../../../../packages/contracts/src/index.js';
import { AuditRepository } from '../repositories/audit.repository.js';
import { AuditService } from './audit.service.js';

@Injectable()
export class AdminConfigService {
  constructor(
    private readonly auditRepo: AuditRepository,
    private readonly auditService: AuditService,
  ) {}

  async listConfig(): Promise<OperationalConfigDto[]> {
    return this.auditRepo.getOperationalConfig();
  }

  async getConfigByKey(key: string): Promise<OperationalConfigDto> {
    const config = await this.auditRepo.getOperationalConfigByKey(key);
    if (!config) {
      throw new NotFoundException(`Parámetro de configuración "${key}" no encontrado`);
    }
    return config;
  }

  async updateConfig(
    key: string,
    value: unknown,
    description: string,
    actorId: string,
    actorRole: ActorRole = 'admin',
  ): Promise<OperationalConfigDto> {
    if (!key || key.trim() === '') {
      throw new BadRequestException('La clave de configuración es obligatoria');
    }

    if (value === undefined) {
      throw new BadRequestException('El valor de configuración es obligatorio');
    }

    // Obtener estado anterior si existía para registrar en auditoría
    const previous = await this.auditRepo.getOperationalConfigByKey(key);
    const updated = await this.auditRepo.updateOperationalConfig(
      key,
      value,
      description ?? previous?.description ?? '',
      actorId,
    );

    // Registro inmutable automático en auditoría
    await this.auditService.recordEvent({
      actorId,
      actorRole,
      action: 'CONFIG_UPDATE',
      entityType: 'config',
      entityId: key,
      beforeState: previous
        ? { value: previous.configValue, description: previous.description }
        : null,
      afterState: { value: updated.configValue, description: updated.description },
      metadata: { source: 'admin_panel' },
    });

    return updated;
  }
}
