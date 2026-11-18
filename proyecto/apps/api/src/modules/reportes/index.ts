export { ReportesModule, type ReportesModuleOptions } from './reportes.module.js';
export { SalesReportService } from './services/sales-report.service.js';
export { AuditService } from './services/audit.service.js';
export { AdminConfigService } from './services/admin-config.service.js';
export { CsvExporterService } from './services/csv-exporter.service.js';
export {
  ReportsRepository,
  type DbClient,
  type OrderProjectionEntity,
  type OrderItemProjectionEntity,
} from './repositories/reports.repository.js';
export { AuditRepository } from './repositories/audit.repository.js';
export { AdminGuard } from './guards/admin.guard.js';
