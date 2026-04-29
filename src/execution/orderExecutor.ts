import type { Settings } from "../config.js";
import type { Logger } from "../logger.js";
import { OrderSigner } from "../polymarket/orderSigner.js";

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

export class OrderExecutor {
  constructor(
    private readonly settings: Settings,
    private readonly orderSigner: OrderSigner,
    private readonly log: Logger,
  ) {}

  async placeOrder(order: Record<string, unknown>): Promise<Record<string, unknown>> {
    order.time = Date.now();
    order.salt = String(Math.floor(Date.now() / 1000));
    order.signature = this.orderSigner.signOrder(order);
    order.maker = this.orderSigner.getAddress();

    const url = `${this.settings.polymarketApiUrl.replace(/\/$/, "")}/order`;
    const res = await fetch(url, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(order),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`place_order HTTP ${res.status}: ${body}`);
    }

    const result = (await res.json()) as Record<string, unknown>;
    this.log.info({ order_id: result.id, side: order.side, price: order.price }, "order_placed");
    return result;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      const url = `${this.settings.polymarketApiUrl.replace(/\/$/, "")}/order/${orderId}`;
      const res = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(String(res.status));
      this.log.info({ order_id: orderId }, "order_cancelled");
      return true;
    } catch (e) {
      this.log.error({ err: e, order_id: orderId }, "order_cancellation_failed");
      return false;
    }
  }

  async batchCancelOrders(orderIds: string[]): Promise<number> {
    if (orderIds.length === 0) return 0;
    try {
      const base = this.settings.polymarketApiUrl.replace(/\/$/, "");
      const res = await fetch(`${base}/orders/cancel`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ orderIds }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      this.log.info({ count: orderIds.length }, "batch_orders_cancelled");
      return orderIds.length;
    } catch (e) {
      this.log.error({ err: e }, "batch_cancel_failed");
      return 0;
    }
  }
}
