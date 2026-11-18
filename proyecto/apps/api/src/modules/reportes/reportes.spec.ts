import 'reflect-metadata';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { AdminGuard } from './guards/admin.guard.js';
import { ReportsRepository, type DbClient } from './repositories/reports.repository.js';
import { AuditRepository } from './repositories/audit.repository.js';
import { SalesReportService } from './services/sales-report.service.js';
import { AuditService } from './services/audit.service.js';
import { AdminConfigService } from './services/admin-config.service.js';
import { CsvExporterService } from './services/csv-exporter.service.js';
import { ReportsController, type HttpResponseLike } from './controllers/reports.controller.js';
import { AuditController } from './controllers/audit.controller.js';
import { AdminConfigController } from './controllers/admin-config.controller.js';
import { ReportesModule } from './reportes.module.js';
import type { ActorRole } from '../../../../../packages/contracts/src/index.js';

type MockAsyncFn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
const mockFn = (): MockAsyncFn => jest.fn<(...args: unknown[]) => Promise<unknown>>();

describe('Módulo Reportes y Administración - Spec #8 (Comprehensive Unit Tests)', () => {
  let mockReportsRepo: { [K in keyof ReportsRepository]: MockAsyncFn };
  let mockAuditRepo: { [K in keyof AuditRepository]: MockAsyncFn };
  let csvExporter: CsvExporterService;
  let salesReportService: SalesReportService;
  let auditService: AuditService;
  let configService: AdminConfigService;
  let reportsController: ReportsController;
  let auditController: AuditController;
  let configController: AdminConfigController;
  let adminGuard: AdminGuard;

  beforeEach(() => {
    mockReportsRepo = {
      getSalesMetrics: mockFn().mockResolvedValue({
        from: '2026-11-01',
        to: '2026-11-07',
        totalSalesCents: 50000,
        totalOrders: 20,
        averageTicketCents: 2500,
        salesByDay: [
          { date: '2026-11-01', totalCents: 50000, totalOrders: 20, averageTicketCents: 2500 },
        ],
        salesByPaymentMethod: [
          { method: 'card', totalCents: 30000, totalOrders: 12, percentage: 60.0 },
          { method: 'cash', totalCents: 20000, totalOrders: 8, percentage: 40.0 },
        ],
      }),
      getTopProducts: mockFn().mockResolvedValue([
        {
          productId: 'prod-1',
          productName: 'Café Latte',
          unitsSold: 80,
          totalCents: 24000,
          rankingByUnits: 1,
          rankingByRevenue: 1,
        },
      ]),
      getPromotionMetrics: mockFn().mockResolvedValue([
        {
          promotionId: 'promo-1',
          promotionName: 'Promoción promo-1',
          holidayName: 'Navidad',
          timesUsed: 15,
          totalDiscountCents: 3000,
          associatedSalesCents: 15000,
          couponLimit: null,
          remainingUses: null,
        },
      ]),
      getTodayOverview: mockFn().mockResolvedValue({
        todaySalesCents: 15000,
        todayOrdersDelivered: 10,
        ordersInProgress: 4,
        pendingTransferVerifications: 2,
      }),
      saveOrderProjection: mockFn().mockResolvedValue(undefined),
      saveOrderItemProjections: mockFn().mockResolvedValue(undefined),
    } as unknown as { [K in keyof ReportsRepository]: MockAsyncFn };

    mockAuditRepo = {
      recordAuditLog: mockFn().mockResolvedValue('audit-uuid-1'),
      queryAuditLogs: mockFn().mockResolvedValue({
        totalCount: 1,
        entries: [
          {
            id: 'audit-uuid-1',
            timestamp: '2026-11-18T10:00:00Z',
            actorId: 'admin-1',
            actorRole: 'admin',
            action: 'CONFIG_UPDATE',
            entityType: 'config',
            entityId: 'payments.cash.max_pending_orders',
            beforeState: { value: 2 },
            afterState: { value: 3 },
            metadata: null,
          },
        ],
      }),
      getOperationalConfig: mockFn().mockResolvedValue([
        {
          configKey: 'payments.cash.max_pending_orders',
          configValue: 2,
          description: 'Límite',
          updatedBy: 'system',
          updatedAt: '2026-11-18T10:00:00Z',
        },
      ]),
      getOperationalConfigByKey: mockFn().mockImplementation((...args: unknown[]) => {
        const key = args[0] as string;
        if (key === 'payments.cash.max_pending_orders') {
          return Promise.resolve({
            configKey: key,
            configValue: 2,
            description: 'Límite',
            updatedBy: 'system',
            updatedAt: '2026-11-18T10:00:00Z',
          });
        }
        return Promise.resolve(null);
      }),
      updateOperationalConfig: mockFn().mockImplementation((...args: unknown[]) => {
        const key = args[0] as string;
        const value = args[1];
        const description = args[2] as string;
        const updatedBy = args[3] as string;
        return Promise.resolve({
          configKey: key,
          configValue: value,
          description,
          updatedBy,
          updatedAt: new Date().toISOString(),
        });
      }),
    } as unknown as { [K in keyof AuditRepository]: MockAsyncFn };

    csvExporter = new CsvExporterService();
    salesReportService = new SalesReportService(
      mockReportsRepo as unknown as ReportsRepository,
      csvExporter,
    );
    auditService = new AuditService(mockAuditRepo as unknown as AuditRepository);
    configService = new AdminConfigService(
      mockAuditRepo as unknown as AuditRepository,
      auditService,
    );

    reportsController = new ReportsController(salesReportService);
    auditController = new AuditController(auditService);
    configController = new AdminConfigController(configService);
    adminGuard = new AdminGuard();
  });

  describe('AdminGuard (RBAC & Control de acceso)', () => {
    const makeContext = (
      user?: { role: string },
      headers: Record<string, string> = {},
    ): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ user, headers }),
        }),
      }) as unknown as ExecutionContext;

    it('permite el acceso si el rol de usuario es admin', () => {
      const ctx = makeContext({ role: 'admin' });
      expect(adminGuard.canActivate(ctx)).toBe(true);
    });

    it('permite el acceso si el encabezado x-user-role es admin', () => {
      const ctx = makeContext(undefined, { 'x-user-role': 'admin' });
      expect(adminGuard.canActivate(ctx)).toBe(true);
    });

    it('lanza UnauthorizedException si no se proporciona usuario ni encabezado', () => {
      const ctx = makeContext(undefined, {});
      expect(() => adminGuard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('lanza ForbiddenException si el rol es personal de cafetería u otro', () => {
      const ctx = makeContext({ role: 'personal' });
      expect(() => adminGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('US1: Reportes de Ventas y Productos', () => {
    it('consulta ventas y retorna métricas agregadas', async () => {
      const res = await reportsController.getSalesReport('2026-11-01', '2026-11-07', 'card');
      expect(res.totalSalesCents).toBe(50000);
      expect(res.totalOrders).toBe(20);
      expect(res.averageTicketCents).toBe(2500);
      expect(mockReportsRepo.getSalesMetrics).toHaveBeenCalledWith(
        '2026-11-01',
        '2026-11-07',
        'card',
      );
    });

    it('consulta ranking de productos más vendidos', async () => {
      const res = await reportsController.getTopProducts('2026-11-01', '2026-11-07', '10');
      expect(res.products).toHaveLength(1);
      expect(res.products[0]?.productName).toBe('Café Latte');
    });

    it('exporta reporte de ventas a CSV mediante respuesta HTTP', async () => {
      const mockRes: HttpResponseLike = {
        setHeader: jest.fn<(...args: unknown[]) => void>(),
        status: jest.fn<(...args: unknown[]) => { send(body: string): void }>().mockReturnValue({
          send: jest.fn<(...args: unknown[]) => void>(),
        }),
      };

      await reportsController.exportReport('sales', '2026-11-01', '2026-11-07', 'csv', mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('valida límites de ranking de productos', async () => {
      await expect(
        salesReportService.getTopProducts({ from: '2026-11-01', to: '2026-11-07', limit: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('SalesReportService valida parámetros de fecha en getSalesReport', async () => {
      await expect(
        salesReportService.getSalesReport({ from: '', to: '2026-11-07' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        salesReportService.getSalesReport({ from: 'inv', to: '2026-11-07' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        salesReportService.getSalesReport({ from: '2026-11-10', to: '2026-11-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('SalesReportService exporta top-products y promotions, y rechaza formatos inválidos', async () => {
      const topCsv = await salesReportService.exportReport({
        type: 'top-products',
        from: '2026-11-01',
        to: '2026-11-07',
        format: 'csv',
      });
      expect(topCsv.filename).toContain('top-products');
      expect(topCsv.csvContent).toContain('RANKING DE PRODUCTOS MAS VENDIDOS');

      const promoCsv = await salesReportService.exportReport({
        type: 'promotions',
        from: '2026-11-01',
        to: '2026-11-07',
        format: 'csv',
      });
      expect(promoCsv.filename).toContain('promotions');
      expect(promoCsv.csvContent).toContain('REPORTE DE USO DE PROMOCIONES');

      await expect(
        salesReportService.exportReport({
          type: 'sales',
          from: '2026-11-01',
          to: '2026-11-07',
          format: 'json' as unknown as 'csv',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        salesReportService.exportReport({
          type: 'otro' as unknown as 'sales',
          from: '2026-11-01',
          to: '2026-11-07',
          format: 'csv',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('US2: Reportes de Promociones', () => {
    it('consulta efectividad de promociones por festividad', async () => {
      const res = await reportsController.getPromotionsReport(
        '2026-11-01',
        '2026-11-07',
        'Navidad',
      );
      expect(res.promotions).toHaveLength(1);
      expect(res.promotions[0]?.holidayName).toBe('Navidad');
    });
  });

  describe('US3: Auditoría inmutable', () => {
    it('consulta logs de auditoría mediante AuditController', async () => {
      const res = await auditController.queryAudit(
        '2026-11-01',
        '2026-11-18',
        'admin-1',
        'config',
        'CONFIG_UPDATE',
        '10',
        '0',
      );
      expect(res.totalCount).toBe(1);
      expect(res.entries[0]?.action).toBe('CONFIG_UPDATE');
    });

    it('registra evento de auditoría mediante AuditController', async () => {
      const res = await auditController.recordAudit(
        {
          actorId: 'admin-1',
          actorRole: 'admin',
          action: 'PRICE_UPDATE',
          entityType: 'product',
          entityId: 'prod-1',
          beforeState: { priceCents: 200 },
          afterState: { priceCents: 250 },
        },
        'header-admin',
        'admin',
      );
      expect(res.id).toBe('audit-uuid-1');
    });

    it('AuditService valida campos obligatorios y roles', async () => {
      await expect(
        auditService.recordEvent({
          actorId: '',
          actorRole: 'admin',
          action: 'ACT',
          entityType: 'ent',
          entityId: 'id',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        auditService.recordEvent({
          actorId: 'user',
          actorRole: 'otro' as unknown as ActorRole,
          action: 'ACT',
          entityType: 'ent',
          entityId: 'id',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('AuditService valida rangos de fecha y límites en queryAuditLogs', async () => {
      await expect(
        auditService.queryAuditLogs({ from: '2026-11-20', to: '2026-11-10' }),
      ).rejects.toThrow(BadRequestException);
      await expect(auditService.queryAuditLogs({ limit: 0 })).rejects.toThrow(BadRequestException);
      await expect(auditService.queryAuditLogs({ limit: 300 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('US4: Configuración operativa y Resumen diario', () => {
    it('lista y obtiene parámetros operativos', async () => {
      const list = await configController.listConfig();
      expect(list).toHaveLength(1);

      const item = await configController.getConfig('payments.cash.max_pending_orders');
      expect(item.configKey).toBe('payments.cash.max_pending_orders');
    });

    it('actualiza parámetro y audita la acción', async () => {
      const updated = await configController.updateConfig(
        'payments.cash.max_pending_orders',
        { value: 4, description: 'Límite nuevo' },
        'admin-header',
        'admin',
      );
      expect(updated.configValue).toBe(4);
    });

    it('obtiene resumen del día mediante overview', async () => {
      const overview = await reportsController.getOverview();
      expect(overview.todaySalesCents).toBe(15000);
      expect(overview.todayOrdersDelivered).toBe(10);
      expect(overview.ordersInProgress).toBe(4);
      expect(overview.pendingTransferVerifications).toBe(2);
    });

    it('AdminConfigService valida existencia y parámetros', async () => {
      await expect(configService.getConfigByKey('inexistente')).rejects.toThrow(NotFoundException);
      await expect(configService.updateConfig('', 5, 'd', 'u')).rejects.toThrow(
        BadRequestException,
      );
      await expect(configService.updateConfig('k', undefined, 'd', 'u')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('CsvExporterService (Cobertura de ramas)', () => {
    it('sanitiza celdas con caracteres de fórmula y especiales', () => {
      expect(csvExporter.sanitizeField('=2+2')).toBe("'=2+2");
      expect(csvExporter.sanitizeField('+593')).toBe("'+593");
      expect(csvExporter.sanitizeField('-10')).toBe("'-10");
      expect(csvExporter.sanitizeField('@mention')).toBe("'@mention");
      expect(csvExporter.sanitizeField('\tindent')).toBe("'\tindent");
      expect(csvExporter.sanitizeField(null)).toBe('');
      expect(csvExporter.sanitizeField(undefined)).toBe('');
      expect(csvExporter.sanitizeField(123)).toBe('123');
      expect(csvExporter.sanitizeField('texto con, coma')).toBe('"texto con, coma"');
      expect(csvExporter.sanitizeField('texto con "comillas"')).toBe('"texto con ""comillas"""');
    });

    it('exporta ventas con totalSalesCents igual a cero', () => {
      const csv = csvExporter.exportSales({
        from: '2026-11-01',
        to: '2026-11-01',
        totalSalesCents: 0,
        totalOrders: 0,
        averageTicketCents: 0,
        salesByDay: [],
        salesByPaymentMethod: [{ method: 'card', totalCents: 0, totalOrders: 0, percentage: 0 }],
      });
      expect(csv).toContain('Ventas Totales (USD),0.00');
    });
  });

  describe('ReportsRepository & AuditRepository con DbClient mock', () => {
    it('ReportsRepository ejecuta consultas SQL de métricas, rankings y proyecciones', async () => {
      const mockDb: DbClient = {
        query: mockFn().mockImplementation((...args: unknown[]) => {
          const text = args[0] as string;
          if (
            text.includes('COALESCE(SUM(total_cents), 0)::BIGINT AS "totalSalesCents"') ||
            text.includes('todaySalesCents')
          ) {
            return Promise.resolve({
              rows: [
                {
                  totalSalesCents: '10000',
                  todaySalesCents: '10000',
                  totalOrders: 5,
                  todayOrdersDelivered: 5,
                },
              ],
              rowCount: 1,
            });
          }
          if (text.includes('TO_CHAR(delivered_at')) {
            return Promise.resolve({
              rows: [{ date: '2026-11-01', totalCents: '10000', totalOrders: 5 }],
              rowCount: 1,
            });
          }
          if (text.includes('payment_method AS "method"')) {
            return Promise.resolve({
              rows: [{ method: 'card', totalCents: '10000', totalOrders: 5 }],
              rowCount: 1,
            });
          }
          if (text.includes('reports.order_item_projection i')) {
            return Promise.resolve({
              rows: [
                { productId: 'p1', productName: 'Prod 1', unitsSold: 10, totalCents: '2000' },
                { productId: 'p2', productName: 'Prod 2', unitsSold: 5, totalCents: '3000' },
              ],
              rowCount: 2,
            });
          }
          if (text.includes("COALESCE(promotion_id, 'sin_promo')")) {
            return Promise.resolve({
              rows: [
                {
                  promotionId: 'p1',
                  holidayName: 'Navidad',
                  timesUsed: 4,
                  totalDiscountCents: '800',
                  associatedSalesCents: '4000',
                },
              ],
              rowCount: 1,
            });
          }
          if (text.includes('COUNT(*) FILTER')) {
            return Promise.resolve({
              rows: [{ inProgress: 2, pendingVerif: 1 }],
              rowCount: 1,
            });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }) as unknown as DbClient['query'],
      };

      const repo = new ReportsRepository(mockDb);

      const sales = await repo.getSalesMetrics('2026-11-01', '2026-11-07', 'card');
      expect(sales.totalSalesCents).toBe(10000);
      expect(sales.totalOrders).toBe(5);

      const top = await repo.getTopProducts('2026-11-01', '2026-11-07', 5);
      expect(top).toHaveLength(2);
      expect(top[0]?.rankingByUnits).toBe(1);

      const promos = await repo.getPromotionMetrics('2026-11-01', '2026-11-07', 'Navidad');
      expect(promos).toHaveLength(1);

      const overview = await repo.getTodayOverview();
      expect(overview.todaySalesCents).toBe(10000);

      await repo.saveOrderProjection({
        id: 'ord-1',
        customerId: 'cust-1',
        paymentMethod: 'card',
        orderStatus: 'delivered',
        totalCents: 2000,
        discountCents: 0,
        promotionId: null,
        holidayName: null,
        createdAt: '2026-11-18',
        deliveredAt: '2026-11-18',
      });

      await repo.saveOrderItemProjections([
        {
          orderId: 'ord-1',
          productId: 'prod-1',
          productName: 'Café',
          quantity: 1,
          unitPriceCents: 2000,
          totalCents: 2000,
          createdAt: '2026-11-18',
        },
      ]);
    });

    it('AuditRepository ejecuta consultas SQL de auditoría y configuración', async () => {
      const mockDb: DbClient = {
        query: mockFn().mockImplementation((...args: unknown[]) => {
          const text = args[0] as string;
          if (text.includes('INSERT INTO reports.audit_log')) {
            return Promise.resolve({ rows: [{ id: 'audit-generated-id' }], rowCount: 1 });
          }
          if (text.includes('SELECT COUNT(*)::INT AS "total" FROM reports.audit_log')) {
            return Promise.resolve({ rows: [{ total: 1 }], rowCount: 1 });
          }
          if (text.includes('SELECT') && text.includes('FROM reports.audit_log')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'audit-1',
                  timestamp: '2026-11-18',
                  actorId: 'adm',
                  actorRole: 'admin',
                  action: 'PRICE_UPDATE',
                  entityType: 'product',
                  entityId: 'p1',
                  beforeState: null,
                  afterState: null,
                  metadata: null,
                },
              ],
              rowCount: 1,
            });
          }
          if (text.includes('reports.operational_config')) {
            return Promise.resolve({
              rows: [
                {
                  configKey: 'k',
                  configValue: 'v',
                  description: 'd',
                  updatedBy: 'u',
                  updatedAt: '2026',
                },
              ],
              rowCount: 1,
            });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }) as unknown as DbClient['query'],
      };

      const repo = new AuditRepository(mockDb);

      const id = await repo.recordAuditLog({
        actorId: 'adm',
        actorRole: 'admin',
        action: 'PRICE_UPDATE',
        entityType: 'product',
        entityId: 'p1',
        beforeState: { price: 100 },
        afterState: { price: 150 },
        metadata: { ip: '127.0.0.1' },
      });
      expect(id).toBe('audit-generated-id');

      const logs = await repo.queryAuditLogs({
        from: '2026-11-01',
        to: '2026-11-18',
        actorId: 'adm',
        entityType: 'product',
        action: 'PRICE_UPDATE',
        limit: 10,
        offset: 0,
      });
      expect(logs.totalCount).toBe(1);

      const allConfig = await repo.getOperationalConfig();
      expect(allConfig).toHaveLength(1);

      const oneConfig = await repo.getOperationalConfigByKey('k');
      expect(oneConfig?.configKey).toBe('k');

      const updated = await repo.updateOperationalConfig('k', 'v2', 'd2', 'adm');
      expect(updated.configKey).toBe('k');
    });
  });

  describe('ReportesModule.register', () => {
    it('registra el módulo dinámicamente con controladores y proveedores exportados', () => {
      const mockDb: DbClient = {
        query: mockFn().mockResolvedValue({ rows: [] }) as unknown as DbClient['query'],
      };
      const dynModule = ReportesModule.register({ db: mockDb });

      expect(dynModule.module).toBe(ReportesModule);
      expect(dynModule.controllers).toBeDefined();
      expect(dynModule.providers).toHaveLength(7);
      expect(dynModule.exports).toHaveLength(5);
    });
  });
});
