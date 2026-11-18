import type {
  DailySalesItemDto,
  PaymentMethodSalesDto,
  PaymentMethodType,
  PromotionReportItemDto,
  SalesReportResponseDto,
  TopProductDto,
} from '../../../../../../packages/contracts/src/index.js';

export interface DbClient {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface OrderProjectionEntity {
  id: string;
  customerId: string;
  paymentMethod: PaymentMethodType;
  orderStatus: string;
  totalCents: number;
  discountCents: number;
  promotionId: string | null;
  holidayName: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface OrderItemProjectionEntity {
  orderId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  createdAt: string;
}

export class ReportsRepository {
  constructor(private readonly db: DbClient) {}

  async getSalesMetrics(
    from: string,
    to: string,
    paymentMethod?: PaymentMethodType,
  ): Promise<SalesReportResponseDto> {
    const toInclusive = `${to}T23:59:59.999Z`;
    const fromStart = `${from}T00:00:00.000Z`;

    // Totales globales del periodo
    let totalQuery = `
      SELECT
        COALESCE(SUM(total_cents), 0)::BIGINT AS "totalSalesCents",
        COUNT(*)::INT AS "totalOrders"
      FROM reports.order_projection
      WHERE order_status = 'delivered'
        AND delivered_at >= $1 AND delivered_at <= $2
    `;
    const totalParams: unknown[] = [fromStart, toInclusive];
    if (paymentMethod) {
      totalQuery += ` AND payment_method = $3`;
      totalParams.push(paymentMethod);
    }

    const totalRes = await this.db.query<{ totalSalesCents: string; totalOrders: number }>(
      totalQuery,
      totalParams,
    );
    const totalSalesCents = Number(totalRes.rows[0]?.totalSalesCents ?? 0);
    const totalOrders = totalRes.rows[0]?.totalOrders ?? 0;
    const averageTicketCents = totalOrders > 0 ? Math.round(totalSalesCents / totalOrders) : 0;

    // Desglose por día
    let dailyQuery = `
      SELECT
        TO_CHAR(delivered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "date",
        COALESCE(SUM(total_cents), 0)::BIGINT AS "totalCents",
        COUNT(*)::INT AS "totalOrders"
      FROM reports.order_projection
      WHERE order_status = 'delivered'
        AND delivered_at >= $1 AND delivered_at <= $2
    `;
    const dailyParams: unknown[] = [fromStart, toInclusive];
    if (paymentMethod) {
      dailyQuery += ` AND payment_method = $3`;
      dailyParams.push(paymentMethod);
    }
    dailyQuery += ` GROUP BY "date" ORDER BY "date" ASC`;

    const dailyRes = await this.db.query<{ date: string; totalCents: string; totalOrders: number }>(
      dailyQuery,
      dailyParams,
    );
    const salesByDay: DailySalesItemDto[] = dailyRes.rows.map((r) => {
      const orders = r.totalOrders;
      const cents = Number(r.totalCents);
      return {
        date: r.date,
        totalCents: cents,
        totalOrders: orders,
        averageTicketCents: orders > 0 ? Math.round(cents / orders) : 0,
      };
    });

    // Desglose por forma de pago
    const methodQuery = `
      SELECT
        payment_method AS "method",
        COALESCE(SUM(total_cents), 0)::BIGINT AS "totalCents",
        COUNT(*)::INT AS "totalOrders"
      FROM reports.order_projection
      WHERE order_status = 'delivered'
        AND delivered_at >= $1 AND delivered_at <= $2
      GROUP BY payment_method
      ORDER BY "totalCents" DESC
    `;
    const methodRes = await this.db.query<{
      method: PaymentMethodType;
      totalCents: string;
      totalOrders: number;
    }>(methodQuery, [fromStart, toInclusive]);

    const salesByPaymentMethod: PaymentMethodSalesDto[] = methodRes.rows.map((r) => {
      const cents = Number(r.totalCents);
      const orders = r.totalOrders;
      const pct = totalSalesCents > 0 ? Number(((cents / totalSalesCents) * 100).toFixed(1)) : 0;
      return {
        method: r.method,
        totalCents: cents,
        totalOrders: orders,
        percentage: pct,
      };
    });

    return {
      from,
      to,
      totalSalesCents,
      totalOrders,
      averageTicketCents,
      salesByDay,
      salesByPaymentMethod,
    };
  }

  async getTopProducts(from: string, to: string, limit = 10): Promise<TopProductDto[]> {
    const toInclusive = `${to}T23:59:59.999Z`;
    const fromStart = `${from}T00:00:00.000Z`;

    const query = `
      SELECT
        i.product_id AS "productId",
        i.product_name AS "productName",
        SUM(i.quantity)::INT AS "unitsSold",
        SUM(i.total_cents)::BIGINT AS "totalCents"
      FROM reports.order_item_projection i
      INNER JOIN reports.order_projection o ON o.id = i.order_id
      WHERE o.order_status = 'delivered'
        AND o.delivered_at >= $1 AND o.delivered_at <= $2
      GROUP BY i.product_id, i.product_name
      ORDER BY "unitsSold" DESC, "totalCents" DESC
      LIMIT $3
    `;
    const res = await this.db.query<{
      productId: string;
      productName: string;
      unitsSold: number;
      totalCents: string;
    }>(query, [fromStart, toInclusive, limit]);

    // Calcular rankings por unidades e ingresos
    const sortedByUnits = [...res.rows];
    const sortedByRevenue = [...res.rows].sort(
      (a, b) => Number(b.totalCents) - Number(a.totalCents),
    );

    return sortedByUnits.map((item, unitIdx) => {
      const revIdx = sortedByRevenue.findIndex((r) => r.productId === item.productId);
      return {
        productId: item.productId,
        productName: item.productName,
        unitsSold: item.unitsSold,
        totalCents: Number(item.totalCents),
        rankingByUnits: unitIdx + 1,
        rankingByRevenue: revIdx + 1,
      };
    });
  }

  async getPromotionMetrics(
    from: string,
    to: string,
    holidayName?: string,
  ): Promise<PromotionReportItemDto[]> {
    const toInclusive = `${to}T23:59:59.999Z`;
    const fromStart = `${from}T00:00:00.000Z`;

    let query = `
      SELECT
        COALESCE(promotion_id, 'sin_promo') AS "promotionId",
        COALESCE(holiday_name, 'General') AS "holidayName",
        COUNT(*)::INT AS "timesUsed",
        COALESCE(SUM(discount_cents), 0)::BIGINT AS "totalDiscountCents",
        COALESCE(SUM(total_cents), 0)::BIGINT AS "associatedSalesCents"
      FROM reports.order_projection
      WHERE order_status = 'delivered'
        AND delivered_at >= $1 AND delivered_at <= $2
        AND promotion_id IS NOT NULL
    `;
    const params: unknown[] = [fromStart, toInclusive];
    if (holidayName) {
      query += ` AND holiday_name = $3`;
      params.push(holidayName);
    }
    query += ` GROUP BY promotion_id, holiday_name ORDER BY "associatedSalesCents" DESC`;

    const res = await this.db.query<{
      promotionId: string;
      holidayName: string;
      timesUsed: number;
      totalDiscountCents: string;
      associatedSalesCents: string;
    }>(query, params);

    return res.rows.map((r) => ({
      promotionId: r.promotionId,
      promotionName: `Promoción ${r.promotionId}`,
      holidayName: r.holidayName,
      timesUsed: r.timesUsed,
      totalDiscountCents: Number(r.totalDiscountCents),
      associatedSalesCents: Number(r.associatedSalesCents),
      couponLimit: null,
      remainingUses: null,
    }));
  }

  async getTodayOverview(): Promise<{
    todaySalesCents: number;
    todayOrdersDelivered: number;
    ordersInProgress: number;
    pendingTransferVerifications: number;
  }> {
    const today = new Date().toISOString().slice(0, 10);
    const startOfDay = `${today}T00:00:00.000Z`;

    const salesQuery = `
      SELECT
        COALESCE(SUM(total_cents), 0)::BIGINT AS "todaySalesCents",
        COUNT(*)::INT AS "todayOrdersDelivered"
      FROM reports.order_projection
      WHERE order_status = 'delivered' AND delivered_at >= $1
    `;
    const salesRes = await this.db.query<{ todaySalesCents: string; todayOrdersDelivered: number }>(
      salesQuery,
      [startOfDay],
    );

    const pendingQuery = `
      SELECT
        COUNT(*) FILTER (WHERE order_status IN ('in_progress', 'confirmed', 'paid'))::INT AS "inProgress",
        COUNT(*) FILTER (WHERE order_status = 'pending_verification')::INT AS "pendingVerif"
      FROM reports.order_projection
    `;
    const pendingRes = await this.db.query<{ inProgress: number; pendingVerif: number }>(
      pendingQuery,
    );

    return {
      todaySalesCents: Number(salesRes.rows[0]?.todaySalesCents ?? 0),
      todayOrdersDelivered: salesRes.rows[0]?.todayOrdersDelivered ?? 0,
      ordersInProgress: pendingRes.rows[0]?.inProgress ?? 0,
      pendingTransferVerifications: pendingRes.rows[0]?.pendingVerif ?? 0,
    };
  }

  async saveOrderProjection(order: OrderProjectionEntity): Promise<void> {
    const query = `
      INSERT INTO reports.order_projection (
        id, customer_id, payment_method, order_status, total_cents, discount_cents,
        promotion_id, holiday_name, created_at, delivered_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        order_status = EXCLUDED.order_status,
        total_cents = EXCLUDED.total_cents,
        discount_cents = EXCLUDED.discount_cents,
        delivered_at = EXCLUDED.delivered_at
    `;
    await this.db.query(query, [
      order.id,
      order.customerId,
      order.paymentMethod,
      order.orderStatus,
      order.totalCents,
      order.discountCents,
      order.promotionId,
      order.holidayName,
      order.createdAt,
      order.deliveredAt,
    ]);
  }

  async saveOrderItemProjections(items: OrderItemProjectionEntity[]): Promise<void> {
    for (const item of items) {
      const query = `
        INSERT INTO reports.order_item_projection (
          order_id, product_id, product_name, quantity, unit_price_cents, total_cents, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      await this.db.query(query, [
        item.orderId,
        item.productId,
        item.productName,
        item.quantity,
        item.unitPriceCents,
        item.totalCents,
        item.createdAt,
      ]);
    }
  }
}
