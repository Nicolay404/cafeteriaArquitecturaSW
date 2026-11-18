import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  AdminOverviewResponseDto,
  ExportReportQueryDto,
  PromotionsReportQueryDto,
  PromotionsReportResponseDto,
  SalesReportQueryDto,
  SalesReportResponseDto,
  TopProductsQueryDto,
  TopProductsResponseDto,
} from '../../../../../../packages/contracts/src/index.js';
import { ReportsRepository } from '../repositories/reports.repository.js';
import { CsvExporterService } from './csv-exporter.service.js';

@Injectable()
export class SalesReportService {
  constructor(
    private readonly reportsRepo: ReportsRepository,
    private readonly csvExporter: CsvExporterService,
  ) {}

  private validateDateRange(from: string, to: string): void {
    if (!from || !to) {
      throw new BadRequestException('Los parámetros "from" y "to" son obligatorios');
    }

    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T00:00:00Z`);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException('Formato de fecha inválido. Utilice el formato YYYY-MM-DD');
    }

    if (fromDate > toDate) {
      throw new BadRequestException('La fecha "from" no puede ser posterior a la fecha "to"');
    }
  }

  async getSalesReport(query: SalesReportQueryDto): Promise<SalesReportResponseDto> {
    this.validateDateRange(query.from, query.to);
    return this.reportsRepo.getSalesMetrics(query.from, query.to, query.paymentMethod);
  }

  async getTopProducts(query: TopProductsQueryDto): Promise<TopProductsResponseDto> {
    this.validateDateRange(query.from, query.to);
    const limit = query.limit ?? 10;
    if (limit < 1 || limit > 100) {
      throw new BadRequestException('El límite debe encontrarse entre 1 y 100');
    }

    const products = await this.reportsRepo.getTopProducts(query.from, query.to, limit);
    return {
      from: query.from,
      to: query.to,
      products,
    };
  }

  async getPromotionsReport(query: PromotionsReportQueryDto): Promise<PromotionsReportResponseDto> {
    this.validateDateRange(query.from, query.to);
    const promotions = await this.reportsRepo.getPromotionMetrics(
      query.from,
      query.to,
      query.holidayName,
    );
    return {
      from: query.from,
      to: query.to,
      promotions,
    };
  }

  async exportReport(
    query: ExportReportQueryDto,
  ): Promise<{ filename: string; csvContent: string }> {
    this.validateDateRange(query.from, query.to);

    if (query.format !== 'csv') {
      throw new BadRequestException(`Formato no soportado: ${query.format}. Solo se admite "csv"`);
    }

    let csvContent = '';
    const filename = `reporte-${query.type}-${query.from}-${query.to}.csv`;

    switch (query.type) {
      case 'sales': {
        const sales = await this.reportsRepo.getSalesMetrics(query.from, query.to);
        csvContent = this.csvExporter.exportSales(sales);
        break;
      }
      case 'top-products': {
        const topProducts = await this.getTopProducts({
          from: query.from,
          to: query.to,
          limit: 50,
        });
        csvContent = this.csvExporter.exportTopProducts(topProducts);
        break;
      }
      case 'promotions': {
        const promos = await this.getPromotionsReport({ from: query.from, to: query.to });
        csvContent = this.csvExporter.exportPromotions(promos);
        break;
      }
      default:
        throw new BadRequestException(
          `Tipo de reporte inválido: ${(query as { type: string }).type}`,
        );
    }

    return { filename, csvContent };
  }

  async getOverview(): Promise<AdminOverviewResponseDto> {
    return this.reportsRepo.getTodayOverview();
  }
}
