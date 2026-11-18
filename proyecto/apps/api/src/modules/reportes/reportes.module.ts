import { type DynamicModule, Module } from '@nestjs/common';
import { AdminConfigController } from './controllers/admin-config.controller.js';
import { AuditController } from './controllers/audit.controller.js';
import { ReportsController } from './controllers/reports.controller.js';
import { AdminGuard } from './guards/admin.guard.js';
import { AuditRepository } from './repositories/audit.repository.js';
import { ReportsRepository, type DbClient } from './repositories/reports.repository.js';
import { AdminConfigService } from './services/admin-config.service.js';
import { AuditService } from './services/audit.service.js';
import { CsvExporterService } from './services/csv-exporter.service.js';
import { SalesReportService } from './services/sales-report.service.js';

export interface ReportesModuleOptions {
  db: DbClient;
}

@Module({})
export class ReportesModule {
  static register(options: ReportesModuleOptions): DynamicModule {
    const reportsRepo = new ReportsRepository(options.db);
    const auditRepo = new AuditRepository(options.db);

    return {
      module: ReportesModule,
      controllers: [ReportsController, AuditController, AdminConfigController],
      providers: [
        { provide: ReportsRepository, useValue: reportsRepo },
        { provide: AuditRepository, useValue: auditRepo },
        CsvExporterService,
        SalesReportService,
        AuditService,
        AdminConfigService,
        AdminGuard,
      ],
      exports: [
        SalesReportService,
        AuditService,
        AdminConfigService,
        ReportsRepository,
        AuditRepository,
      ],
    };
  }
}
