/**
 * Arbitrage evaluator for Polymarket BTC 5-minute / 15-minute binary markets.
 *
 * Strategy:
 *   When endTime_5m == endTime_15m both markets resolve using the *same* BTC
 *   finish price.  One leg always wins → guaranteed payout >= $1.00.
 *   Profit is locked when combinedCost = leg1Price + leg2Price < 1.00.
 *
 * Case A  beatPrice_15m > beatPrice_5m  → BUY UP(5m)  + BUY DOWN(15m)
 * Case B  beatPrice_5m  > beatPrice_15m → BUY UP(15m) + BUY DOWN(5m)
 * Case C  beatPrice equal               → check both combinations
 */

export interface MarketSnapshot {
  marketId: string;
  beatPrice: number;   // BTC resolution threshold parsed from market question
  priceUp: number;     // best ask for UP token (what we pay to buy)
  priceDown: number;   // best ask for DOWN token
  endTime: string;     // ISO-8601 resolution time
  tokenIdUp: string;
  tokenIdDown: string;
  capturedAt: number;  // Date.now() when snapshot was fetched
}

export type ArbCase = "A" | "B" | "C_AB" | "C_BA";

export interface ArbOpportunity {
  case: ArbCase;
  leg1MarketId: string;
  leg1Direction: "UP" | "DOWN";
  leg1TokenId: string;
  leg1Price: number;
  leg2MarketId: string;
  leg2Direction: "UP" | "DOWN";
  leg2TokenId: string;
  leg2Price: number;
  combinedCost: number;
  expectedProfit: number;  // 1.00 - combinedCost (minimum; can be 2.00 - cost if both win)
}

export function evaluate(
  snap5m: MarketSnapshot,
  snap15m: MarketSnapshot,
  threshold: number,
  staleMs: number,
): ArbOpportunity | null {
  const now = Date.now();

  if (now - snap5m.capturedAt > staleMs || now - snap15m.capturedAt > staleMs) {
    return null; // stale data guard
  }

  if (snap5m.endTime !== snap15m.endTime) {
    return null; // markets resolve at different times — no guaranteed hedge
  }

  const bp5 = snap5m.beatPrice;
  const bp15 = snap15m.beatPrice;

  if (bp15 > bp5) {
    // Case A: beatPrice_15m > beatPrice_5m
    // BUY UP(5m) + BUY DOWN(15m)
    const cost = snap5m.priceUp + snap15m.priceDown;
    if (cost < threshold) {
      return build("A", snap5m, "UP", snap15m, "DOWN", cost);
    }
  } else if (bp5 > bp15) {
    // Case B: beatPrice_5m > beatPrice_15m
    // BUY UP(15m) + BUY DOWN(5m)
    const cost = snap15m.priceUp + snap5m.priceDown;
    if (cost < threshold) {
      return build("B", snap15m, "UP", snap5m, "DOWN", cost);
    }
  } else {
    // Case C: equal beat prices — check both combinations
    const costAB = snap5m.priceUp + snap15m.priceDown;
    if (costAB < threshold) {
      return build("C_AB", snap5m, "UP", snap15m, "DOWN", costAB);
    }
    const costBA = snap15m.priceUp + snap5m.priceDown;
    if (costBA < threshold) {
      return build("C_BA", snap15m, "UP", snap5m, "DOWN", costBA);
    }
  }

  return null;
}

function build(
  c: ArbCase,
  s1: MarketSnapshot,
  d1: "UP" | "DOWN",
  s2: MarketSnapshot,
  d2: "UP" | "DOWN",
  combinedCost: number,
): ArbOpportunity {
  return {
    case: c,
    leg1MarketId: s1.marketId,
    leg1Direction: d1,
    leg1TokenId: d1 === "UP" ? s1.tokenIdUp : s1.tokenIdDown,
    leg1Price: d1 === "UP" ? s1.priceUp : s1.priceDown,
    leg2MarketId: s2.marketId,
    leg2Direction: d2,
    leg2TokenId: d2 === "UP" ? s2.tokenIdUp : s2.tokenIdDown,
    leg2Price: d2 === "UP" ? s2.priceUp : s2.priceDown,
    combinedCost,
    expectedProfit: 1.0 - combinedCost,
  };
}
