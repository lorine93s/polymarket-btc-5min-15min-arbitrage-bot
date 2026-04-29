import type { Settings } from "../config.js";
import type { Logger } from "../logger.js";
import type { MarketSnapshot } from "../arbitrage/evaluator.js";

interface TokenInfo {
  token_id: string;
  outcome: string;
  price: string | number;
}

interface MarketInfo {
  condition_id: string;
  question: string;
  end_date_iso: string;
  tokens: TokenInfo[];
}

interface BookLevel {
  price: string;
  size: string;
}

interface OrderbookResponse {
  asks: BookLevel[];
  bids: BookLevel[];
}

export class PolymarketRestClient {
  private readonly base: string;

  constructor(
    private readonly settings: Settings,
    private readonly log: Logger,
  ) {
    this.base = settings.polymarketApiUrl.replace(/\/$/, "");
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  /**
   * Fetch a complete MarketSnapshot for one market:
   *   1. GET /markets/{id}  → token IDs, end time, question (for beat price)
   *   2. GET /book?token_id= for each token → best ask prices
   */
  async fetchMarketSnapshot(marketId: string): Promise<MarketSnapshot> {
    const info = await this.get<MarketInfo>(`/markets/${marketId}`);

    // Identify UP and DOWN tokens by outcome label
    const upToken   = info.tokens.find((t) => /^(up|yes)$/i.test(t.outcome.trim()));
    const downToken = info.tokens.find((t) => /^(down|no)$/i.test(t.outcome.trim()));

    if (!upToken || !downToken) {
      const labels = info.tokens.map((t) => t.outcome).join(", ");
      throw new Error(`Market ${marketId}: cannot identify UP/DOWN tokens. Found: [${labels}]`);
    }

    const beatPrice = parseBeatPrice(info.question);
    if (beatPrice === null) {
      throw new Error(`Market ${marketId}: no beat price in question: "${info.question}"`);
    }

    // Fetch orderbooks for both tokens in parallel to get best ask
    const [upBook, downBook] = await Promise.all([
      this.get<OrderbookResponse>(`/book?token_id=${upToken.token_id}`).catch(() => null),
      this.get<OrderbookResponse>(`/book?token_id=${downToken.token_id}`).catch(() => null),
    ]);

    const priceUp   = bestAsk(upBook,   Number(upToken.price));
    const priceDown = bestAsk(downBook, Number(downToken.price));

    this.log.debug({
      marketId,
      beatPrice,
      priceUp,
      priceDown,
      endTime: info.end_date_iso,
    }, "snapshot_fetched");

    return {
      marketId,
      beatPrice,
      priceUp,
      priceDown,
      endTime:    info.end_date_iso,
      tokenIdUp:  upToken.token_id,
      tokenIdDown: downToken.token_id,
      capturedAt: Date.now(),
    };
  }

  /** Fetch positions that are redeemable for a given wallet address. */
  async getRedeemablePositions(address: string): Promise<Record<string, unknown>[]> {
    try {
      const params = new URLSearchParams({ user: address, redeemable: "true" });
      const res = await fetch(`${this.base}/positions?${params}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return [];
      return res.json() as Promise<Record<string, unknown>[]>;
    } catch {
      return [];
    }
  }
}

/** Extract the BTC beat price from a market question string.
 *  Handles formats like "$67,000", "$67000", "$67,500.50"
 */
function parseBeatPrice(question: string): number | null {
  const match = question.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const val = parseFloat(match[1].replace(/,/g, ""));
  return isNaN(val) ? null : val;
}

/** Return the best ask price from an orderbook response,
 *  falling back to the token's own price field if no asks available.
 */
function bestAsk(book: OrderbookResponse | null, fallback: number): number {
  if (book?.asks?.length) {
    const p = parseFloat(book.asks[0].price);
    if (!isNaN(p) && p > 0) return p;
  }
  return fallback > 0 ? fallback : 0.5;
}
