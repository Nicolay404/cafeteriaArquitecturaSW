import { describe, expect, it } from 'vitest';
import { CsvExporterService } from '../../../apps/api/src/modules/reportes/services/csv-exporter.service.js';
import type {
  PromotionsReportResponseDto,
  SalesReportResponseDto,
  TopProductsResponseDto,
} from '../../../packages/contracts/src/index.js';

describe('CsvExporterService (RFC 4180 & Formula Injection Prevention)', () => {
  const exporter = new CsvExporterService();

  describe('Sanitización contra inyección de fórmulas (CSV Injection)', () => {
    it('antepone una comilla simple a celdas que comienzan con =, +, -, @ o tab', () => {
      expect(exporter.sanitizeField('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(exporter.sanitizeField('+12345')).toBe("'+12345");
      expect(exporter.sanitizeField('-50.00')).toBe("'-50.00");
      expect(exporter.sanitizeField('@cmd')).toBe("'@cmd");
      expect(exporter.sanitizeField('\tcalc')).toBe("'\tcalc");
    });

    it('no altera cadenas seguras comunes', () => {
      expect(exporter.sanitizeField('Café Americano')).toBe('Café Americano');
      expect(exporter.sanitizeField('1250')).toBe('1250');
      expect(exporter.sanitizeField('2026-11-18')).toBe('2026-11-18');
    });

    it('maneja valores null, undefined y números', () => {
      expect(exporter.sanitizeField(null)).toBe('');
      expect(exporter.sanitizeField(undefined)).toBe('');
      expect(exporter.sanitizeField(42)).toBe('42');
    });

    it('escapa comillas dobles y comas según RFC 4180', () => {
      expect(exporter.sanitizeField('Café, con leche')).toBe('"Café, con leche"');
      expect(exporter.sanitizeField('Taza "Especial"')).toBe('"Taza ""Especial"""');
      expect(exporter.sanitizeField('Línea 1\nLínea 2')).toBe('"Línea 1\nLínea 2"');
    });
  });

  describe('Exportación de reportes', () => {
    it('exporta reporte de ventas con estructura y totales en dólares', () => {
      const data: SalesReportResponseDto = {
        from: '2026-11-01',
        to: '2026-11-02',
        totalSalesCents: 15000,
        totalOrders: 10,
        averageTicketCents: 1500,
        salesByDay: [
          {
            date: '2026-11-01',
            totalCents: 10000,
            totalOrders: 6,
            averageTicketCents: 1667,
          },
          {
            date: '2026-11-02',
            totalCents: 5000,
            totalOrders: 4,
            averageTicketCents: 1250,
          },
        ],
        salesByPaymentMethod: [
          {
            method: 'card',
            totalCents: 10000,
            totalOrders: 6,
            percentage: 66.7,
          },
          {
            method: 'cash',
            totalCents: 5000,
            totalOrders: 4,
            percentage: 33.3,
          },
        ],
      };

      const csv = exporter.exportSales(data);

      expect(csv).toContain('REPORTE DE VENTAS');
      expect(csv).toContain('Periodo,2026-11-01 a 2026-11-02');
      expect(csv).toContain('Ventas Totales (USD),150.00');
      expect(csv).toContain('Pedidos Totales,10');
      expect(csv).toContain('Ticket Medio (USD),15.00');
      expect(csv).toContain('DESGLOSE DIARIO');
      expect(csv).toContain('2026-11-01,6,100.00,16.67');
      expect(csv).toContain('VENTAS POR FORMA DE PAGO');
      expect(csv).toContain('card,6,100.00,66.7');
    });

    it('exporta ranking de productos más vendidos', () => {
      const data: TopProductsResponseDto = {
        from: '2026-11-01',
        to: '2026-11-07',
        products: [
          {
            productId: 'p-1',
            productName: 'Café Americano',
            unitsSold: 50,
            totalCents: 12500,
            rankingByUnits: 1,
            rankingByRevenue: 2,
          },
          {
            productId: 'p-2',
            productName: 'Mocaccino, Grande',
            unitsSold: 40,
            totalCents: 16000,
            rankingByUnits: 2,
            rankingByRevenue: 1,
          },
        ],
      };

      const csv = exporter.exportTopProducts(data);

      expect(csv).toContain('RANKING DE PRODUCTOS MAS VENDIDOS');
      expect(csv).toContain('Ranking Unidades,Ranking Ingresos,ID Producto,Nombre Producto');
      expect(csv).toContain('1,2,p-1,Café Americano,50,125.00');
      expect(csv).toContain('2,1,p-2,"Mocaccino, Grande",40,160.00');
    });

    it('exporta reporte de promociones', () => {
      const data: PromotionsReportResponseDto = {
        from: '2026-11-01',
        to: '2026-11-07',
        promotions: [
          {
            promotionId: 'promo-nav',
            promotionName: 'Navidad 2x1',
            holidayName: 'Navidad',
            timesUsed: 20,
            totalDiscountCents: 4000,
            associatedSalesCents: 16000,
          },
        ],
      };

      const csv = exporter.exportPromotions(data);

      expect(csv).toContain('REPORTE DE USO DE PROMOCIONES');
      expect(csv).toContain('promo-nav,Navidad 2x1,Navidad,20,40.00,160.00');
    });
  });
});
