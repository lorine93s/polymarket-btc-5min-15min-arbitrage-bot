import type { Settings } from "./config.js";
import type { Logger } from "./logger.js";
import { PolymarketRestClient } from "./polymarket/restClient.js";
import { OrderSigner } from "./polymarket/orderSigner.js";
import { OrderExecutor } from "./execution/orderExecutor.js";
import { AutoRedeem } from "./services/autoRedeem.js";
import { evaluate, type MarketSnapshot, type ArbOpportunity } from "./arbitrage/evaluator.js";

export class ArbBot {
  private running = false;
  private dailyTradeCount = 0;
  private totalExposureUsd = 0;
  private lastResetDate = new Date().toDateString();

  private readonly rest: PolymarketRestClient;
  private readonly signer: OrderSigner;
  private readonly executor: OrderExecutor;
  private readonly redeemer: AutoRedeem;

  constructor(
    private readonly settings: Settings,
    private readonly log: Logger,
  ) {
    this.rest     = new PolymarketRestClient(settings, log);
    this.signer   = new OrderSigner(settings.privateKey, log);
    this.executor = new OrderExecutor(settings, this.signer, log);
    this.redeemer = new AutoRedeem(settings, log);
  }

  interrupt(): void {
    this.running = false;
  }

  async run(): Promise<void> {
    this.running = true;
    this.log.info(
      {
        wallet:     this.signer.getAddress(),
        market_5m:  this.settings.marketId5m,
        market_15m: this.settings.marketId15m,
        threshold:  this.settings.arbThreshold,
        size:       this.settings.defaultSize,
      },
      "arb_bot_starting",
    );

    void this.runRedeemLoop();

    while (this.running) {
      try {
        this.resetDailyCountIfNeeded();
        await this.tick();
      } catch (e) {
        this.log.error({ err: e }, "tick_error");
      }
      await sleep(this.settings.pollIntervalMs);
    }

    this.log.info("arb_bot_stopped");
  }

  // ── Core evaluation loop ────────────────────────────────────────────────

  private async tick(): Promise<void> {
    let snap5m: MarketSnapshot;
    let snap15m: MarketSnapshot;

    try {
      [snap5m, snap15m] = await Promise.all([
        this.rest.fetchMarketSnapshot(this.settings.marketId5m),
        this.rest.fetchMarketSnapshot(this.settings.marketId15m),
      ]);
    } catch (e) {
      this.log.warn({ err: e }, "snapshot_fetch_failed");
      return;
    }

    const synced = snap5m.endTime === snap15m.endTime;

    this.log.debug({
      synced,
      endTime: snap5m.endTime,
      bp5m:    snap5m.beatPrice,
      bp15m:   snap15m.beatPrice,
      up5m:    snap5m.priceUp.toFixed(4),
      dn5m:    snap5m.priceDown.toFixed(4),
      up15m:   snap15m.priceUp.toFixed(4),
      dn15m:   snap15m.priceDown.toFixed(4),
    }, "tick");

    if (!synced) {
      this.log.debug({ end5m: snap5m.endTime, end15m: snap15m.endTime }, "endtime_mismatch_skipping");
      return;
    }

    const opp = evaluate(
      snap5m,
      snap15m,
      this.settings.arbThreshold,
      this.settings.staleDataMaxAgeMs,
    );

    if (!opp) {
      this.log.debug(
        {
          costAB: (snap5m.priceUp + snap15m.priceDown).toFixed(4),
          costBA: (snap15m.priceUp + snap5m.priceDown).toFixed(4),
          threshold: this.settings.arbThreshold,
        },
        "no_arb_opportunity",
      );
      return;
    }

    this.log.info({
      case:          opp.case,
      combined_cost: opp.combinedCost.toFixed(4),
      profit_est:    opp.expectedProfit.toFixed(4),
      threshold:     this.settings.arbThreshold,
      bp5m:          snap5m.beatPrice,
      bp15m:         snap15m.beatPrice,
    }, "arb_opportunity_detected");

    if (!this.canTrade()) return;

    await this.executeArb(opp);
  }

  // ── Risk guards ─────────────────────────────────────────────────────────

  private canTrade(): boolean {
    if (this.dailyTradeCount >= this.settings.maxDailyTrades) {
      this.log.warn(
        { count: this.dailyTradeCount, max: this.settings.maxDailyTrades },
        "daily_trade_limit_reached",
      );
      return false;
    }
    if (this.totalExposureUsd >= this.settings.maxExposureUsd) {
      this.log.warn(
        { exposure: this.totalExposureUsd, max: this.settings.maxExposureUsd },
        "max_exposure_reached",
      );
      return false;
    }
    return true;
  }

  // ── Dual-leg execution ──────────────────────────────────────────────────

  private async executeArb(opp: ArbOpportunity): Promise<void> {
    const size = String(this.settings.defaultSize);

    const leg1 = {
      market:   opp.leg1MarketId,
      token_id: opp.leg1TokenId,
      side:     "BUY",
      size,
      price:    String(opp.leg1Price),
    };
    const leg2 = {
      market:   opp.leg2MarketId,
      token_id: opp.leg2TokenId,
      side:     "BUY",
      size,
      price:    String(opp.leg2Price),
    };

    this.log.info({
      case: opp.case,
      leg1: { market: opp.leg1MarketId, dir: opp.leg1Direction, price: opp.leg1Price },
      leg2: { market: opp.leg2MarketId, dir: opp.leg2Direction, price: opp.leg2Price },
      size: this.settings.defaultSize,
    }, "executing_arb_trade");

    const start = Date.now();

    const [res1, res2] = await Promise.all([
      this.executor.placeOrder(leg1).catch((e) => {
        this.log.error({ err: e }, "leg1_order_failed");
        return null;
      }),
      this.executor.placeOrder(leg2).catch((e) => {
        this.log.error({ err: e }, "leg2_order_failed");
        return null;
      }),
    ]);

    const latencyMs = Date.now() - start;
    const leg1Ok = res1 !== null;
    const leg2Ok = res2 !== null;

    if (leg1Ok && leg2Ok) {
      this.dailyTradeCount++;
      this.totalExposureUsd += this.settings.defaultSize * 2;
      this.log.info({
        case:        opp.case,
        leg1_id:     (res1 as Record<string, unknown>).id,
        leg2_id:     (res2 as Record<string, unknown>).id,
        latency_ms:  latencyMs,
        daily_count: this.dailyTradeCount,
        exposure_usd: this.totalExposureUsd,
      }, "arb_trade_complete");
    } else if (leg1Ok && !leg2Ok) {
      this.log.warn({
        leg1_id: (res1 as Record<string, unknown>).id,
        case: opp.case,
      }, "leg2_failed_directional_exposure_open");
    } else if (!leg1Ok && leg2Ok) {
      this.log.warn({
        leg2_id: (res2 as Record<string, unknown>).id,
        case: opp.case,
      }, "leg1_failed_directional_exposure_open");
    } else {
      this.log.error({ case: opp.case }, "both_legs_failed");
    }
  }

  // ── Background redeem loop ──────────────────────────────────────────────

  private async runRedeemLoop(): Promise<void> {
    while (this.running) {
      await sleep(300_000); // check every 5 minutes
      if (!this.running) break;
      try {
        if (this.settings.autoRedeemEnabled) {
          await this.redeemer.autoRedeemAll(this.signer.getAddress());
        }
      } catch (e) {
        this.log.error({ err: e }, "redeem_loop_error");
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private resetDailyCountIfNeeded(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyTradeCount  = 0;
      this.totalExposureUsd = 0;
      this.lastResetDate    = today;
      this.log.info("daily_counters_reset");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
