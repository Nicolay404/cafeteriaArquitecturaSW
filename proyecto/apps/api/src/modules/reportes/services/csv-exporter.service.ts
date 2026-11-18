import { Injectable } from '@nestjs/common';
import type {
  PromotionsReportResponseDto,
  SalesReportResponseDto,
  TopProductsResponseDto,
} from '../../../../../../packages/contracts/src/index.js';

@Injectable()
export class CsvExporterService {
  /**
   * Sanitiza un campo de texto para prevenir inyecciones de fórmulas (CSV Injection / Formula Injection).
   * Si el valor comienza con '=', '+', '-', '@', o tabulación, se antepone una comilla simple.
   */
  sanitizeField(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    let str = String(value);

    // Detección de caracteres de inicio de fórmula en hojas de cálculo
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }

    // Escapado RFC 4180: si contiene comillas, comas o saltos de línea, envolver entre comillas
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      str = `"${str.replace(/"/g, '""')}"`;
    }

    return str;
  }

  exportSales(report: SalesReportResponseDto): string {
    const lines: string[] = [];

    // Cabecera de resumen
    lines.push('REPORTE DE VENTAS');
    lines.push(`Periodo,${this.sanitizeField(report.from)} a ${this.sanitizeField(report.to)}`);
    lines.push(`Ventas Totales (USD),${(report.totalSalesCents / 100).toFixed(2)}`);
    lines.push(`Pedidos Totales,${report.totalOrders}`);
    lines.push(`Ticket Medio (USD),${(report.averageTicketCents / 100).toFixed(2)}`);
    lines.push('');

    // Desglose diario
    lines.push('DESGLOSE DIARIO');
    lines.push('Fecha,Pedidos,Total (USD),Ticket Medio (USD)');
    for (const d of report.salesByDay) {
      lines.push(
        [
          this.sanitizeField(d.date),
          d.totalOrders,
          (d.totalCents / 100).toFixed(2),
          (d.averageTicketCents / 100).toFixed(2),
        ].join(','),
      );
    }
    lines.push('');

    // Desglose por forma de pago
    lines.push('VENTAS POR FORMA DE PAGO');
    lines.push('Forma de Pago,Pedidos,Total (USD),Porcentaje (%)');
    for (const p of report.salesByPaymentMethod) {
      lines.push(
        [
          this.sanitizeField(p.method),
          p.totalOrders,
          (p.totalCents / 100).toFixed(2),
          p.percentage.toFixed(1),
        ].join(','),
      );
    }

    return lines.join('\r\n');
  }

  exportTopProducts(report: TopProductsResponseDto): string {
    const lines: string[] = [];

    lines.push('RANKING DE PRODUCTOS MAS VENDIDOS');
    lines.push(`Periodo,${this.sanitizeField(report.from)} a ${this.sanitizeField(report.to)}`);
    lines.push(
      'Ranking Unidades,Ranking Ingresos,ID Producto,Nombre Producto,Unidades Vendidas,Total (USD)',
    );

    for (const p of report.products) {
      lines.push(
        [
          p.rankingByUnits,
          p.rankingByRevenue,
          this.sanitizeField(p.productId),
          this.sanitizeField(p.productName),
          p.unitsSold,
          (p.totalCents / 100).toFixed(2),
        ].join(','),
      );
    }

    return lines.join('\r\n');
  }

  exportPromotions(report: PromotionsReportResponseDto): string {
    const lines: string[] = [];

    lines.push('REPORTE DE USO DE PROMOCIONES');
    lines.push(`Periodo,${this.sanitizeField(report.from)} a ${this.sanitizeField(report.to)}`);
    lines.push(
      'ID Promocion,Nombre Promocion,Festividad,Veces Usada,Descuento Total (USD),Ventas Asociadas (USD)',
    );

    for (const p of report.promotions) {
      lines.push(
        [
          this.sanitizeField(p.promotionId),
          this.sanitizeField(p.promotionName),
          this.sanitizeField(p.holidayName),
          p.timesUsed,
          (p.totalDiscountCents / 100).toFixed(2),
          (p.associatedSalesCents / 100).toFixed(2),
        ].join(','),
      );
    }

    return lines.join('\r\n');
  }
}
