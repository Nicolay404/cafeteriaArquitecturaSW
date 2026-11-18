import { Body, Controller, Get, Headers, Param, Put, UseGuards } from '@nestjs/common';
import type {
  ActorRole,
  OperationalConfigDto,
  UpdateOperationalConfigDto,
} from '../../../../../../packages/contracts/src/index.js';
import { AdminGuard } from '../guards/admin.guard.js';
import { AdminConfigService } from '../services/admin-config.service.js';

@Controller('api/admin/config')
@UseGuards(AdminGuard)
export class AdminConfigController {
  constructor(private readonly configService: AdminConfigService) {}

  @Get()
  async listConfig(): Promise<OperationalConfigDto[]> {
    return this.configService.listConfig();
  }

  @Get(':key')
  async getConfig(@Param('key') key: string): Promise<OperationalConfigDto> {
    return this.configService.getConfigByKey(key);
  }

  @Put(':key')
  async updateConfig(
    @Param('key') key: string,
    @Body() body: UpdateOperationalConfigDto,
    @Headers('x-actor-id') headerActorId?: string,
    @Headers('x-user-role') headerRole?: string,
  ): Promise<OperationalConfigDto> {
    const actorId = headerActorId ?? 'admin-user';
    const actorRole = (headerRole ?? 'admin') as ActorRole;

    return this.configService.updateConfig(
      key,
      body.value,
      body.description ?? '',
      actorId,
      actorRole,
    );
  }
}
