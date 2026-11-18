import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { startInfrastructure, type Infrastructure } from './infrastructure.fixture.js';
import { ReportsRepository } from '../../apps/api/src/modules/reportes/repositories/reports.repository.js';
import { AuditRepository } from '../../apps/api/src/modules/reportes/repositories/audit.repository.js';

const migration002Path = fileURLToPath(
  new URL('../../infra/migrations/002_reports_schema.sql', import.meta.url),
);

describe('Spec #8: Administración, reportes y auditoría (Integration Tests)', () => {
  let infrastructure: Infrastructure;
  let client: Client;
  let reportsRepo: ReportsRepository;
  let auditRepo: AuditRepository;

  beforeAll(async () => {
    infrastructure = await startInfrastructure();
    client = new Client({ connectionString: infrastructure.databaseUrl });
    await client.connect();

    // Aplicar esquema técnico 001 y migración 002_reports_schema.sql
    const migration002 = readFileSync(migration002Path, 'utf-8');
    await client.query(migration002);

    reportsRepo = new ReportsRepository(client);
    auditRepo = new AuditRepository(client);
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await infrastructure?.stop();
  });

  describe('Persistencia analítica y consultas de ventas', () => {
    it('ingesta proyecciones sintéticas de pedidos y calcula métricas exactas al centavo', async () => {
      const now = new Date().toISOString();

      await reportsRepo.saveOrderProjection({
        id: 'ord-int-1',
        customerId: 'cust-anon-1',
        paymentMethod: 'card',
        orderStatus: 'delivered',
        totalCents: 1500,
        discountCents: 0,
        promotionId: null,
        holidayName: null,
        createdAt: now,
        deliveredAt: now,
      });

      await reportsRepo.saveOrderProjection({
        id: 'ord-int-2',
        customerId: 'cust-anon-2',
        paymentMethod: 'cash',
        orderStatus: 'delivered',
        totalCents: 2500,
        discountCents: 500,
        promotionId: 'promo-navidad',
        holidayName: 'Navidad',
        createdAt: now,
        deliveredAt: now,
      });

      // Pedido cancelado que DEBE ser excluido de las ventas
      await reportsRepo.saveOrderProjection({
        id: 'ord-int-cancelled',
        customerId: 'cust-anon-3',
        paymentMethod: 'card',
        orderStatus: 'cancelled',
        totalCents: 5000,
        discountCents: 0,
        promotionId: null,
        holidayName: null,
        createdAt: now,
        deliveredAt: now,
      });

      const today = now.slice(0, 10);
      const metrics = await reportsRepo.getSalesMetrics(today, today);

      expect(metrics.totalSalesCents).toBe(4000); // 1500 + 2500
      expect(metrics.totalOrders).toBe(2);
      expect(metrics.averageTicketCents).toBe(2000); // 4000 / 2
      expect(metrics.salesByPaymentMethod).toHaveLength(2);
    });

    it('calcula ranking de productos más vendidos en base a ítems proyectados', async () => {
      const now = new Date().toISOString();

      await reportsRepo.saveOrderItemProjections([
        {
          orderId: 'ord-int-1',
          productId: 'prod-cafe',
          productName: 'Café Americano',
          quantity: 2,
          unitPriceCents: 750,
          totalCents: 1500,
          createdAt: now,
        },
        {
          orderId: 'ord-int-2',
          productId: 'prod-latte',
          productName: 'Café Latte',
          quantity: 3,
          unitPriceCents: 1000,
          totalCents: 3000,
          createdAt: now,
        },
      ]);

      const today = now.slice(0, 10);
      const ranking = await reportsRepo.getTopProducts(today, today, 5);

      expect(ranking).toHaveLength(2);
      expect(ranking[0]?.productId).toBe('prod-latte');
      expect(ranking[0]?.unitsSold).toBe(3);
      expect(ranking[0]?.rankingByUnits).toBe(1);
    });
  });

  describe('Auditoría inmutable', () => {
    it('registra evento en reports.audit_log e impide modificación o borrado mediante trigger', async () => {
      const id = await auditRepo.recordAuditLog({
        actorId: 'admin-integration',
        actorRole: 'admin',
        action: 'PRICE_UPDATE',
        entityType: 'product',
        entityId: 'prod-cafe',
        beforeState: { priceCents: 700 },
        afterState: { priceCents: 750 },
        metadata: { source: 'integration_test' },
      });

      expect(id).toBeDefined();

      const queryRes = await auditRepo.queryAuditLogs({
        actorId: 'admin-integration',
        action: 'PRICE_UPDATE',
      });
      expect(queryRes.totalCount).toBeGreaterThanOrEqual(1);

      // Intento de UPDATE DEBE ser rechazado por el trigger PostgreSQL
      await expect(
        client.query(`UPDATE reports.audit_log SET action = 'ALTERED' WHERE id = $1`, [id]),
      ).rejects.toThrow('Audit log entries are immutable and cannot be updated or deleted');

      // Intento de DELETE DEBE ser rechazado por el trigger PostgreSQL
      await expect(
        client.query(`DELETE FROM reports.audit_log WHERE id = $1`, [id]),
      ).rejects.toThrow('Audit log entries are immutable and cannot be updated or deleted');
    });
  });

  describe('Configuración operativa', () => {
    it('permite consultar y actualizar parámetros operativos en caliente', async () => {
      const updated = await auditRepo.updateOperationalConfig(
        'payments.cash.max_pending_orders',
        5,
        'Límite para temporada alta',
        'admin-integration',
      );

      expect(updated.configKey).toBe('payments.cash.max_pending_orders');
      expect(updated.configValue).toBe(5);

      const retrieved = await auditRepo.getOperationalConfigByKey(
        'payments.cash.max_pending_orders',
      );
      expect(retrieved?.configValue).toBe(5);
    });
  });
});
