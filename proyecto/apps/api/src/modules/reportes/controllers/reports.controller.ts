import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type {
  AdminOverviewResponseDto,
  ExportFormatType,
  ExportReportType,
  PaymentMethodType,
  PromotionsReportResponseDto,
  SalesReportResponseDto,
  TopProductsResponseDto,
} from '../../../../../../packages/contracts/src/index.js';
import { AdminGuard } from '../guards/admin.guard.js';
import { SalesReportService } from '../services/sales-report.service.js';

export interface HttpResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): { send(body: string): void };
}

@Controller('api/admin')
@UseGuards(AdminGuard)
export class ReportsController {
  constructor(private readonly salesReportService: SalesReportService) {}

  @Get('reports/sales')
  async getSalesReport(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('paymentMethod') paymentMethod?: PaymentMethodType,
  ): Promise<SalesReportResponseDto> {
    return this.salesReportService.getSalesReport({ from, to, paymentMethod });
  }

  @Get('reports/top-products')
  async getTopProducts(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limitStr?: string,
  ): Promise<TopProductsResponseDto> {
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    return this.salesReportService.getTopProducts({ from, to, limit });
  }

  @Get('reports/promotions')
  async getPromotionsReport(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('holidayName') holidayName?: string,
  ): Promise<PromotionsReportResponseDto> {
    return this.salesReportService.getPromotionsReport({ from, to, holidayName });
  }

  @Get('reports/export')
  async exportReport(
    @Query('type') type: ExportReportType,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('format') format: ExportFormatType,
    @Res() res: HttpResponseLike,
  ): Promise<void> {
    const { filename, csvContent } = await this.salesReportService.exportReport({
      type,
      from,
      to,
      format,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  }

  @Get('overview')
  async getOverview(): Promise<AdminOverviewResponseDto> {
    return this.salesReportService.getOverview();
  }
}
