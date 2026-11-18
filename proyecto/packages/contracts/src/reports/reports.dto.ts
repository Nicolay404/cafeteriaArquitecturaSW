export type PaymentMethodType = 'card' | 'cash' | 'transfer';

export interface SalesReportQueryDto {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  paymentMethod?: PaymentMethodType | undefined;
}

export interface DailySalesItemDto {
  date: string;
  totalCents: number;
  totalOrders: number;
  averageTicketCents: number;
}

export interface PaymentMethodSalesDto {
  method: PaymentMethodType;
  totalCents: number;
  totalOrders: number;
  percentage: number;
}

export interface SalesReportResponseDto {
  from: string;
  to: string;
  totalSalesCents: number;
  totalOrders: number;
  averageTicketCents: number;
  salesByDay: DailySalesItemDto[];
  salesByPaymentMethod: PaymentMethodSalesDto[];
}

export interface TopProductsQueryDto {
  from: string;
  to: string;
  limit?: number | undefined;
}

export interface TopProductDto {
  productId: string;
  productName: string;
  unitsSold: number;
  totalCents: number;
  rankingByUnits: number;
  rankingByRevenue: number;
}

export interface TopProductsResponseDto {
  from: string;
  to: string;
  products: TopProductDto[];
}

export interface PromotionsReportQueryDto {
  from: string;
  to: string;
  holidayName?: string | undefined;
}

export interface PromotionReportItemDto {
  promotionId: string;
  promotionName: string;
  holidayName: string;
  timesUsed: number;
  totalDiscountCents: number;
  associatedSalesCents: number;
  couponLimit?: number | null | undefined;
  remainingUses?: number | null | undefined;
}

export interface PromotionsReportResponseDto {
  from: string;
  to: string;
  promotions: PromotionReportItemDto[];
}

export type ExportReportType = 'sales' | 'top-products' | 'promotions';
export type ExportFormatType = 'csv';

export interface ExportReportQueryDto {
  type: ExportReportType;
  from: string;
  to: string;
  format: ExportFormatType;
}

export type ActorRole = 'admin' | 'personal' | 'system';

export interface AuditLogEntryDto {
  id: string;
  timestamp: string;
  actorId: string;
  actorRole: ActorRole;
  action: string;
  entityType: string;
  entityId: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null | undefined;
}

export interface CreateAuditEntryDto {
  actorId: string;
  actorRole: ActorRole;
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: Record<string, unknown> | null | undefined;
  afterState?: Record<string, unknown> | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}

export interface AuditQueryDto {
  from?: string | undefined;
  to?: string | undefined;
  actorId?: string | undefined;
  entityType?: string | undefined;
  action?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface AuditResponseDto {
  totalCount: number;
  entries: AuditLogEntryDto[];
}

export interface OperationalConfigDto {
  configKey: string;
  configValue: unknown;
  description: string;
  updatedBy: string;
  updatedAt: string;
}

export interface UpdateOperationalConfigDto {
  value: unknown;
  description?: string | undefined;
}

export interface AdminOverviewResponseDto {
  todaySalesCents: number;
  todayOrdersDelivered: number;
  ordersInProgress: number;
  pendingTransferVerifications: number;
}
