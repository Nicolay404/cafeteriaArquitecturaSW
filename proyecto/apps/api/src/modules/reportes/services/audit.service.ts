import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ActorRole,
  AuditQueryDto,
  AuditResponseDto,
  CreateAuditEntryDto,
} from '../../../../../../packages/contracts/src/index.js';
import { AuditRepository } from '../repositories/audit.repository.js';

@Injectable()
export class AuditService {
  constructor(private readonly auditRepo: AuditRepository) {}

  async recordEvent(entry: CreateAuditEntryDto): Promise<string> {
    if (!entry.actorId || !entry.action || !entry.entityType || !entry.entityId) {
      throw new BadRequestException(
        'Los campos actorId, action, entityType y entityId son obligatorios para auditoría',
      );
    }

    const validRoles: ActorRole[] = ['admin', 'personal', 'system'];
    if (!validRoles.includes(entry.actorRole)) {
      throw new BadRequestException(`Rol de actor inválido: ${entry.actorRole}`);
    }

    return this.auditRepo.recordAuditLog(entry);
  }

  async queryAuditLogs(filters: AuditQueryDto): Promise<AuditResponseDto> {
    if (filters.from && filters.to) {
      const fromDate = new Date(`${filters.from}T00:00:00Z`);
      const toDate = new Date(`${filters.to}T00:00:00Z`);
      if (fromDate > toDate) {
        throw new BadRequestException('La fecha "from" no puede ser posterior a la fecha "to"');
      }
    }

    if (filters.limit !== undefined && (filters.limit < 1 || filters.limit > 200)) {
      throw new BadRequestException('El límite debe situarse entre 1 y 200 registros');
    }

    return this.auditRepo.queryAuditLogs(filters);
  }
}
