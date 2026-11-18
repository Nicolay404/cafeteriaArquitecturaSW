import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  ActorRole,
  AuditResponseDto,
  CreateAuditEntryDto,
} from '../../../../../../packages/contracts/src/index.js';
import { AdminGuard } from '../guards/admin.guard.js';
import { AuditService } from '../services/audit.service.js';

@Controller('api/admin/audit')
@UseGuards(AdminGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async queryAudit(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('actorId') actorId?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ): Promise<AuditResponseDto> {
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;

    return this.auditService.queryAuditLogs({
      from,
      to,
      actorId,
      entityType,
      action,
      limit,
      offset,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async recordAudit(
    @Body() body: CreateAuditEntryDto,
    @Headers('x-actor-id') headerActorId?: string,
    @Headers('x-user-role') headerRole?: string,
  ): Promise<{ id: string }> {
    const actorId = body.actorId || headerActorId || 'admin-user';
    const actorRole = (body.actorRole || headerRole || 'admin') as ActorRole;

    const id = await this.auditService.recordEvent({
      ...body,
      actorId,
      actorRole,
    });
    return { id };
  }
}
