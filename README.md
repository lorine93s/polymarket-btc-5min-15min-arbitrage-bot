# Polymarket BTC Arbitrage Bot
## Professional BTC 5-Minute & 15-Minute Binary Prediction Market Arbitrage Engine

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-Use%20at%20own%20risk-orange)](#license)

Production-grade **Polymarket BTC arbitrage bot** that detects and executes **cross-timeframe arbitrage** between synchronized BTC 5-minute and 15-minute binary prediction markets.

Built with **TypeScript (Node.js 20+)**, this bot is designed for traders who want a rigorous, configurable, and observable engine for exploiting price inefficiencies in Polymarket's short-horizon BTC markets.

---

## Table of Contents

1. [What This Bot Does](#what-this-bot-does)
2. [Critical Concept: Beat Price](#critical-concept-beat-price)
3. [Arbitrage Strategy Explained](#arbitrage-strategy-explained)
   - [When Does Arbitrage Exist?](#when-does-arbitrage-exist)
   - [Case A: 15m Beat Price > 5m Beat Price](#case-a-15m-beat-price--5m-beat-price)
   - [Case B: 5m Beat Price > 15m Beat Price](#case-b-5m-beat-price--5m-beat-price)
   - [Case C: Equal Beat Prices](#case-c-equal-beat-prices)
4. [Why This Works (Payout Mechanics)](#why-this-works-payout-mechanics)
5. [Architecture](#architecture)
6. [Key Modules](#key-modules)
7. [Quick Start](#quick-start)
8. [Environment Variables Reference](#environment-variables-reference)
9. [Risk Management](#risk-management)
10. [Monitoring and Observability](#monitoring-and-observability)
11. [Parameter Tuning Guide](#parameter-tuning-guide)
12. [Troubleshooting](#troubleshooting)
13. [Safety and Compliance](#safety-and-compliance)

---

## What This Bot Does

This bot continuously monitors **BTC 5-minute** and **BTC 15-minute** binary prediction markets on Polymarket. When both markets share the **same `endTime`** (i.e., they resolve using the exact same final BTC price), the bot evaluates whether a **risk-free or near-risk-free arbitrage** exists across the two markets.

- **Real-time market scanning** — WebSocket + REST feeds for both 5m and 15m markets
- **Synchronized market detection** — Only evaluates pairs where `endTime_5m == endTime_15m`
- **Beat-price-aware arbitrage** — Applies the correct directional trade logic based on each market's beat price
- **Atomic dual-leg execution** — Places both legs (UP and DOWN) within a configurable timeout window
- **Risk controls** — Daily trade limits, position sizing caps, stale-data protection
- **Full observability** — Prometheus metrics, structured JSON logs (Pino)
- **Auto-redeem** — Optionally redeems settled positions above a USD threshold

---

## Critical Concept: Beat Price

> **Understanding beat price is essential before running this bot.**

Each BTC binary market on Polymarket has a **beat price** — a fixed BTC price threshold used exclusively to determine which token wins at expiry.

| Property | Description |
|----------|-------------|
| **What it is** | A fixed BTC price threshold set when the market opens |
| **What it is NOT** | A trading price, bid/ask spread, last traded price, or fair value |
| **Role** | Acts like a binary option strike price — purely a resolution threshold |

### Resolution Rule

At `endTime`, the market resolves using `finish_price` (the actual BTC spot price):

```
finish_price > beat_price  →  UP token wins   → payout = $1.00 per share
finish_price < beat_price  →  DOWN token wins  → payout = $1.00 per share
```

**Example:**
- Market opens. `beat_price = $67,000`
- At `endTime`, BTC is at `$67,500`
- Since `67,500 > 67,000` → **UP token holders receive $1.00 per share**
- DOWN token holders receive $0.00

The **trading prices** (what you pay for UP or DOWN shares) fluctuate based on market supply and demand — and those price inefficiencies are what this bot exploits.

---

## Arbitrage Strategy Explained

### When Does Arbitrage Exist?

The core insight: if two markets (**5m** and **15m**) resolve at the **exact same time** using the **exact same BTC finish price**, then exactly **one outcome combination is guaranteed to pay out $1.00**.

The bot only evaluates arbitrage when:

```
endTime_5m == endTime_15m
```

This means both markets will be decided by the same `finish_price`. You can then structure a **hedged position** across the two markets that is guaranteed to pay $1.00 at expiry — and profit if the combined cost is below $1.00.

---

### Case A: 15m Beat Price > 5m Beat Price

**Condition:** `beatPrice_15m > beatPrice_5m`

**Example:** `beatPrice_15m = $68,000`, `beatPrice_5m = $66,000`

**Outcome analysis at expiry:**

| Scenario | BTC finish_price | 5m market result | 15m market result | Combined payout |
|----------|-----------------|------------------|-------------------|-----------------|
| BTC very low | `< 66,000` | DOWN wins ✓ | DOWN wins ✓ | Only one pays — skip |
| BTC in between | `66,000 < price < 68,000` | **UP wins ✓** | **DOWN wins ✓** | **Both pay $1.00** |
| BTC very high | `> 68,000` | UP wins ✓ | UP wins ✓ | Only one pays — skip |

Wait — in the "BTC in between" zone, **both legs pay**. But you only hold one leg per market. The correct trade is:

**Trade: BUY UP (5m) + BUY DOWN (15m)**

- If `finish_price` is between the two beat prices → **both tokens pay $1.00**
- If `finish_price` is outside the range → **one token pays $1.00**, the other pays $0.00

**Net payout:** Always $1.00 minimum (one leg always wins). Sometimes $2.00 (both legs win).

**Entry condition:**
```
Execute if: price_up_5m + price_down_15m < ARB_THRESHOLD
```

Where `ARB_THRESHOLD` is your target combined cost (e.g., `0.97` for 3% expected profit floor).

---

### Case B: 5m Beat Price > 15m Beat Price

**Condition:** `beatPrice_5m > beatPrice_15m`

**Example:** `beatPrice_5m = $69,000`, `beatPrice_15m = $65,000`

This is the mirror of Case A. The guaranteed-win zone is when `finish_price` is between the two beat prices.

**Trade: BUY UP (15m) + BUY DOWN (5m)**

**Entry condition:**
```
Execute if: price_up_15m + price_down_5m < ARB_THRESHOLD
```

---

### Case C: Equal Beat Prices

**Condition:** `beatPrice_5m == beatPrice_15m`

When both markets use the same beat price, the same finish price will resolve both markets identically. There is no guaranteed dual-win zone.

The bot evaluates **both leg combinations** and executes whichever passes the threshold first:

```
Check: price_up_5m + price_down_15m < ARB_THRESHOLD   (Case A logic)
Check: price_up_15m + price_down_5m < ARB_THRESHOLD   (Case B logic)
```

This covers scenarios where temporary price dislocations create an edge even with equal beat prices.

---

## Why This Works (Payout Mechanics)

**Full explanation of the guarantee:**

In a binary prediction market, the UP and DOWN tokens for the same market always sum to **exactly $1.00 at expiry**:

```
payout(UP) + payout(DOWN) = $1.00  (for the same market at expiry)
```

When `endTime_5m == endTime_15m`, you hold positions in **two separate markets**, each with its own beat price. The payout structure looks like this:

```
Position:   BUY UP (5m)  at price p1
            BUY DOWN (15m) at price p2

Total cost: p1 + p2

Scenarios:
  finish_price > beatPrice_15m > beatPrice_5m:
    → UP (5m) pays $1.00, UP (15m) pays $1.00
    → You hold UP (5m) → receive $1.00
    → DOWN (15m) pays $0.00 → receive $0.00
    → Net: $1.00 − (p1 + p2)

  beatPrice_15m > finish_price > beatPrice_5m:
    → UP (5m) pays $1.00
    → DOWN (15m) pays $1.00
    → Net: $2.00 − (p1 + p2)  ← best case

  finish_price < beatPrice_5m < beatPrice_15m:
    → DOWN (5m) pays $1.00 (you don't hold it) → $0
    → DOWN (15m) pays $1.00 → receive $1.00
    → Net: $1.00 − (p1 + p2)
```

**Key insight:** In every scenario, you receive **at least $1.00**. So if `p1 + p2 < 1.00`, you have a locked profit.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     BTC Arbitrage Bot Engine                         │
│                                                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────────────┐  │
│  │  5m Market   │    │  15m Market  │    │  Market Pair Detector  │  │
│  │  Feed (WS)   │    │  Feed (WS)   │    │  (endTime sync check)  │  │
│  └──────┬───────┘    └──────┬───────┘    └──────────┬─────────────┘  │
│         │                   │                        │                │
│         └──────────┬────────┘                        │                │
│                    ▼                                 ▼                │
│           ┌─────────────────┐             ┌──────────────────┐       │
│           │  Arbitrage      │             │  Beat Price      │       │
│           │  Evaluator      │◄────────────│  Comparator      │       │
│           │  (Cases A/B/C)  │             │  (5m vs 15m)     │       │
│           └────────┬────────┘             └──────────────────┘       │
│                    │                                                  │
│                    ▼                                                  │
│           ┌─────────────────┐                                        │
│           │  Risk Manager   │  ← daily limits, position sizing       │
│           │  + Threshold    │    stale data guard, exposure caps      │
│           │    Check        │                                        │
│           └────────┬────────┘                                        │
│                    │                                                  │
│                    ▼                                                  │
│           ┌─────────────────┐                                        │
│           │  Dual-Leg Order │  ← atomic execution, ≤50ms window      │
│           │  Executor       │    leg1 (UP/DOWN) + leg2 (DOWN/UP)     │
│           └────────┬────────┘                                        │
│                    │                                                  │
│         ┌──────────┴──────────┐                                      │
│         ▼                     ▼                                      │
│  ┌─────────────┐      ┌───────────────┐                              │
│  │  Prometheus │      │  Pino Logger  │                              │
│  │  Metrics    │      │  (JSON audit) │                              │
│  └─────────────┘      └───────────────┘                              │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌────────────────┐
  │  Auto-Redeem   │  ← background worker, settled positions
  │  Worker        │
  └────────────────┘
```

### System Flow

```
1. Market Polling
   REST + WebSocket → current prices, beat prices, endTimes for 5m and 15m markets

2. Sync Detection
   Filter pairs where endTime_5m == endTime_15m

3. Beat Price Comparison
   Determine Case A, B, or C based on beatPrice_5m vs beatPrice_15m

4. Threshold Evaluation
   Compute combined leg cost; compare against ARB_THRESHOLD

5. Risk Validation
   Daily trade count, position sizing, exposure cap, stale data age

6. Dual-Leg Execution
   Submit both orders atomically within execution timeout

7. State Persistence + Logging
   Write trade record; update metrics; log structured JSON
```

---

## Key Modules

| Module | File | Role |
|--------|------|------|
| **Entry point** | `src/main.ts` | Process bootstrap, signal handlers, metrics server |
| **Bot orchestrator** | `src/bot.ts` | Main arbitrage loop, market lifecycle, WS + REST coordination |
| **Config & validation** | `src/config.ts` | Zod-validated env vars, wallet address derivation |
| **REST client** | `src/polymarket/restClient.ts` | Market list, orderbook, balances, open orders |
| **WebSocket client** | `src/polymarket/websocketClient.ts` | L2 book subscribe, reconnect loop, stale-data detection |
| **Order signing** | `src/polymarket/orderSigner.ts` | Ethers.js Wallet signing for CLOB orders |
| **Quote engine** | `src/marketMaker/quoteEngine.ts` | Price and sizing for each arbitrage leg |
| **Inventory manager** | `src/inventory/inventoryManager.ts` | Position tracking, exposure helpers |
| **Risk manager** | `src/risk/riskManager.ts` | Pre-trade validation: limits, exposure, skew |
| **Order executor** | `src/execution/orderExecutor.ts` | Place, cancel, batch cancel orders via REST |
| **Auto-redeem** | `src/services/autoRedeem.ts` | Poll + redeem settled positions above threshold |
| **Metrics** | `src/services/metrics.ts` | Prometheus counters, gauges, histograms |
| **Logger** | `src/logger.ts` | Pino JSON logging factory |

---

## Quick Start

### Prerequisites

- **Node.js 20+** and **npm**
- A **Polygon wallet** funded with USDC (for trading collateral)
- Your wallet's `PRIVATE_KEY`
- The **Polymarket market IDs** for the BTC 5m and 15m markets you want to trade

> Find market IDs on [Polymarket](https://polymarket.com) or via the [Gamma API](https://gamma-api.polymarket.com/markets).

---

### 1. Clone and Install

```bash
git clone https://github.com/lorine93s/polymarket-btc-arbitrage-bot.git
cd polymarket-btc-arbitrage-bot
npm install
npm run build
```

---

### 2. Configure Environment

```bash
copy .env.example .env
```

Open `.env` and set at minimum:

```env
# Your Polygon wallet private key (never commit this)
PRIVATE_KEY=0xYOUR_PRIVATE_KEY

# Polymarket market IDs
MARKET_ID_5M=0xYOUR_5MIN_MARKET_ID
MARKET_ID_15M=0xYOUR_15MIN_MARKET_ID

# Arbitrage threshold — execute when combined leg cost is below this
ARB_THRESHOLD=0.97

# Position sizing
DEFAULT_SIZE=50.0
MAX_EXPOSURE_USD=500.0
```

See [Environment Variables Reference](#environment-variables-reference) for all options.

---

### 3. Run

**Production (compiled JS):**
```bash
npm run build
npm start
```

**Development (TypeScript directly, hot-reload friendly):**
```bash
npm run dev
```

**Verify it is running:**
```bash
# Check Prometheus metrics endpoint
curl http://localhost:9305/metrics

# Watch logs
npm start 2>&1 | npx pino-pretty
```

---

### 4. First-run Checklist

- [ ] Bot connects to Polymarket WebSocket without errors
- [ ] Bot finds the 5m and 15m markets in REST response
- [ ] Logs show `market_pair_detected` with matching `endTime`
- [ ] Logs show `arb_evaluation` with computed `combined_cost`
- [ ] (Optional) Increase `LOG_LEVEL=DEBUG` to see full pricing detail

---

## Environment Variables Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `PRIVATE_KEY` | Polygon wallet private key | `0xabc123...` |
| `MARKET_ID_5M` | Polymarket market ID for BTC 5m UP/DOWN | `0x1234...` |
| `MARKET_ID_15M` | Polymarket market ID for BTC 15m UP/DOWN | `0x5678...` |

### Arbitrage Strategy

| Variable | Default | Description |
|----------|---------|-------------|
| `ARB_THRESHOLD` | `0.97` | Execute when combined leg cost ≤ this value. `0.97` = minimum 3% profit margin. Lower = more selective. |
| `DEFAULT_SIZE` | `50.0` | Base trade size in USDC per leg |
| `MAX_DAILY_TRADES` | `20` | Hard cap on number of arbitrage executions per day |
| `EXECUTION_TIMEOUT_MS` | `50` | Max milliseconds to submit both legs (atomic window) |
| `STALE_DATA_MAX_AGE_MS` | `5000` | Reject market data older than this (ms) to avoid acting on stale prices |

### Risk Controls

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_EXPOSURE_USD` | `1000.0` | Maximum total open exposure across both legs (USD) |
| `MIN_EXPOSURE_USD` | `-1000.0` | Minimum net exposure (USD) |
| `MAX_POSITION_SIZE_USD` | `500.0` | Cap per individual position |
| `INVENTORY_SKEW_LIMIT` | `0.3` | Max allowed inventory skew (0–1). `0.3` = 30% |
| `STOP_LOSS_PCT` | `0.05` | Stop-loss threshold as a fraction of capital |

### Execution and Timing

| Variable | Default | Description |
|----------|---------|-------------|
| `QUOTE_REFRESH_RATE_MS` | `1000` | Minimum interval between full price re-evaluations (ms) |
| `CANCEL_REPLACE_INTERVAL_MS` | `500` | Loop sleep between cancel/replace cycles (ms) |
| `ORDER_LIFETIME_MS` | `3000` | Cancel orders older than this (ms) |
| `BATCH_CANCELLATIONS` | `true` | Group cancels into batch API call when possible |
| `TAKER_DELAY_MS` | `0` | Optional delay before taker-style order submission (ms) |

### Auto-Redeem

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_REDEEM_ENABLED` | `true` | Automatically redeem settled positions |
| `REDEEM_THRESHOLD_USD` | `1.0` | Minimum USD value to trigger redemption |

### API Endpoints

| Variable | Default | Description |
|----------|---------|-------------|
| `POLYMARKET_API_URL` | `https://clob.polymarket.com` | Polymarket CLOB REST base URL |
| `POLYMARKET_WS_URL` | `wss://clob-ws.polymarket.com` | Polymarket WebSocket URL |
| `MARKET_DISCOVERY_ENABLED` | `true` | Discover markets via REST list; otherwise use direct market fetch |

### Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Pino log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `METRICS_HOST` | `0.0.0.0` | Prometheus metrics bind host |
| `METRICS_PORT` | `9305` | Prometheus metrics HTTP port |
| `ENVIRONMENT` | `development` | Label attached to logs and metrics |

---

## Risk Management

### Understanding the Risks

This strategy is designed to be **directionally neutral** — you profit from price inefficiency, not from predicting BTC direction. However, risks remain:

| Risk | Description | Mitigation |
|------|-------------|------------|
| **Execution risk** | Leg 1 fills but Leg 2 fails → directional exposure | `EXECUTION_TIMEOUT_MS`, retry logic |
| **Slippage** | Final fill price differs from evaluated price | Set `ARB_THRESHOLD` conservatively (e.g. `0.95`) |
| **Stale data** | Bot acts on old prices that have moved | `STALE_DATA_MAX_AGE_MS` guard |
| **Market resolution edge cases** | Finish price exactly equals beat price | Review Polymarket's tie-breaking rules per market |
| **Liquidity** | Not enough depth to fill your size | Lower `DEFAULT_SIZE`; monitor book depth |
| **API limits** | Too many orders in a short window | `MAX_DAILY_TRADES`, `QUOTE_REFRESH_RATE_MS` |

### Recommended First-Run Settings

Start conservatively and scale up only after validating profitability:

```env
ARB_THRESHOLD=0.95          # Strong edge only — tighter than theoretical breakeven
DEFAULT_SIZE=10.0            # Small notional per leg
MAX_EXPOSURE_USD=100.0       # Low total exposure cap
MAX_DAILY_TRADES=5           # Very few trades per day to start
STALE_DATA_MAX_AGE_MS=3000   # Aggressive stale-data rejection
```

### Best Practices

1. **Always paper-test first** — Run with `DEFAULT_SIZE=0` or a simulation mode before committing capital
2. **Monitor logs at `DEBUG` level** on day one — verify beat prices, endTimes, and cost calculations match your expectations
3. **Never commit your `PRIVATE_KEY`** — use `.env` and keep it out of version control
4. **Track daily PnL** independently — cross-reference Prometheus `pm_arb_profit_usd` with your Polymarket account
5. **Watch for market closure** — markets stop trading before `endTime`; ensure your polling catches this
6. **Verify market IDs regularly** — Polymarket creates new markets for each interval; IDs change

---

## Monitoring and Observability

### Prometheus Metrics

Scrape endpoint (default): `http://localhost:9305/metrics`

| Metric | Type | Description |
|--------|------|-------------|
| `pm_arb_opportunities_detected_total` | Counter | Number of valid arbitrage pairs found (endTime match) |
| `pm_arb_trades_executed_total` | Counter | Number of dual-leg trades submitted |
| `pm_arb_trades_failed_total` | Counter | Execution failures (leg 1 or leg 2) |
| `pm_arb_profit_usd` | Gauge | Running realized profit estimate (USD) |
| `pm_arb_combined_cost` | Histogram | Distribution of evaluated combined leg costs |
| `pm_arb_execution_latency_ms` | Histogram | Time from decision to both legs submitted |
| `pm_arb_exposure_usd` | Gauge | Current total open exposure |
| `pm_arb_daily_trade_count` | Gauge | Trades executed today vs `MAX_DAILY_TRADES` |
| `pm_ws_reconnects_total` | Counter | WebSocket reconnection events |

### Structured Log Events

All logs are JSON (Pino). Set `LOG_LEVEL=DEBUG` for full detail.

**Key log events:**

```json
{ "level": "INFO",  "msg": "market_pair_detected",   "endTime": "2024-01-15T14:05:00Z", "beatPrice_5m": 67000, "beatPrice_15m": 68500 }
{ "level": "INFO",  "msg": "arb_evaluation",          "case": "A", "combined_cost": 0.943, "threshold": 0.97, "valid": true }
{ "level": "INFO",  "msg": "trade_executing",          "leg1": "BUY_UP_5M", "leg2": "BUY_DOWN_15M", "size": 50 }
{ "level": "INFO",  "msg": "trade_complete",           "leg1_order_id": "0x...", "leg2_order_id": "0x...", "latency_ms": 34 }
{ "level": "WARN",  "msg": "stale_data_rejected",      "age_ms": 6200, "max_age_ms": 5000 }
{ "level": "WARN",  "msg": "leg2_execution_failed",    "leg1_order_id": "0x...", "error": "timeout" }
{ "level": "ERROR", "msg": "ws_disconnected",          "market": "5m", "reconnect_in_ms": 1000 }
```

**Pretty-print logs during development:**
```bash
npm run dev | npx pino-pretty
```

---

## Parameter Tuning Guide

### Setting `ARB_THRESHOLD`

This is your most critical parameter. It defines how much edge you require before entering.

| Threshold | Minimum edge | Trade frequency | Notes |
|-----------|-------------|-----------------|-------|
| `0.99` | 1% | Very high | Catches most dislocations; risk of small-edge trades |
| `0.97` | 3% | Moderate | **Recommended default** — good balance |
| `0.95` | 5% | Lower | Conservative; only strong dislocations |
| `0.90` | 10% | Rare | Very selective; near-certain edge when it fires |

### Setting `DEFAULT_SIZE`

Size per leg in USDC. Start small. The bot scales down automatically if `MAX_EXPOSURE_USD` headroom tightens.

| Account size | Suggested `DEFAULT_SIZE` | Suggested `MAX_EXPOSURE_USD` |
|-------------|--------------------------|------------------------------|
| $500 | $10–25 | $200 |
| $2,000 | $50–100 | $800 |
| $10,000 | $200–500 | $4,000 |

### Execution Timing

For short-horizon markets (5m intervals), speed matters. The faster you evaluate and execute, the less likely prices move between your evaluation and fill.

```env
QUOTE_REFRESH_RATE_MS=500      # Faster refresh for short intervals
EXECUTION_TIMEOUT_MS=50        # Tight atomic window
STALE_DATA_MAX_AGE_MS=2000     # Aggressive staleness for 5m markets
```

---

## Troubleshooting

### Bot starts but never detects arbitrage

1. Confirm both `MARKET_ID_5M` and `MARKET_ID_15M` point to **currently active** markets
2. Check logs for `market_pair_detected` — if absent, `endTime` values are not matching
3. Enable `LOG_LEVEL=DEBUG` to see raw `endTime` values being compared
4. Verify market IDs via the Polymarket Gamma API:
   ```bash
   curl "https://gamma-api.polymarket.com/markets?slug=btc-up-or-down-5-minutes"
   ```

### `arb_evaluation` always shows `valid: false`

- `combined_cost` is above your `ARB_THRESHOLD` — this is normal in efficient markets
- Try `ARB_THRESHOLD=0.99` temporarily to confirm evaluation logic is working
- Check that beat prices differ between markets (equal beat prices reduce opportunities)

### Leg 2 execution failures

- Indicates Leg 1 filled but Leg 2 timed out → you now have directional exposure
- Increase `EXECUTION_TIMEOUT_MS` to `100` or `200` if network latency is high
- Check `pm_arb_execution_latency_ms` histogram for typical execution times
- Monitor `pm_arb_trades_failed_total` counter

### WebSocket disconnections

- Client auto-reconnects with exponential backoff
- Check `POLYMARKET_WS_URL` is correct: `wss://clob-ws.polymarket.com`
- Firewall/proxy may block WebSocket connections — try a direct network path
- Check `pm_ws_reconnects_total` counter for reconnection frequency

### `STALE_DATA_REJECTED` warnings constantly firing

- Your network latency is high relative to `STALE_DATA_MAX_AGE_MS`
- Increase `STALE_DATA_MAX_AGE_MS` to `10000` (10 seconds) as a test
- Consider running the bot closer to Polymarket's infrastructure (e.g. a US East cloud VM)

### Orders rejected with auth errors

- `PRIVATE_KEY` invalid or wallet not allowlisted on Polymarket
- Confirm you have completed Polymarket's API key / wallet registration
- Ensure your Polygon address has USDC balance and allowances set

---

## Safety and Compliance

- This bot **places real orders** and **spends real USDC** when configured with a live private key and funded wallet
- Always run in a **simulation or read-only mode** before going live
- Never commit `.env` or expose your `PRIVATE_KEY` in logs or version control
- Polymarket enforces its own [Terms of Service](https://polymarket.com/tos) — ensure automated trading is permitted in your jurisdiction
- Prediction market trading involves **capital risk**; there is no guarantee of profit even with arbitrage strategies (execution risk, fill failures, API outages)
- Maintain **independent audit logs** beyond what this bot produces

---

## Frequently Asked Questions

**Q: Is this truly risk-free arbitrage?**
A: The theoretical payout structure guarantees ≥$1.00 when `endTime_5m == endTime_15m` and beat prices differ. In practice, execution risk (partial fills, leg 2 failure) and slippage mean it is *near-zero-risk* rather than *zero-risk*. Set `ARB_THRESHOLD` conservatively to buffer these costs.

**Q: How often do synchronized markets occur?**
A: Polymarket creates BTC 5-minute and 15-minute markets continuously. Synchronization (matching `endTime`) occurs naturally at 15-minute boundaries. The bot will detect these and evaluate automatically.

**Q: Can I run this for ETH or other assets?**
A: The strategy logic (beat price arbitrage across synchronized timeframes) is asset-agnostic. Update `MARKET_ID_5M` and `MARKET_ID_15M` to the relevant ETH or SOL markets and it will apply identically.

**Q: What happens if only one leg fills?**
A: You have an open directional position. The bot logs a `leg2_execution_failed` warning. Monitor for this and close the single-leg position manually or extend the bot with an unwind routine.

**Q: How do I find the right market IDs?**
A: Use the Polymarket Gamma API:
```bash
curl "https://gamma-api.polymarket.com/markets?slug=btc-up-or-down"
```
Or browse [polymarket.com](https://polymarket.com) and copy the market ID from the URL.

---

## Future Enhancements

- Multi-asset support (ETH, SOL, other short-horizon markets)
- Dynamic threshold sizing based on historical edge distribution
- Unwind routine for partial fills / single-leg exposures
- Position recovery across bot restarts
- Backtesting engine using historical beat prices and market prices
- Configurable leg-size asymmetry for skewed beat price gaps

---

## License

Use at your own risk. This software is provided as-is with no warranty.

Trading prediction markets involves **real financial risk**. Arbitrage strategies can suffer losses from execution failures, API outages, and market microstructure changes.

Ensure compliance with your local regulations and [Polymarket's Terms of Service](https://polymarket.com/tos) before production use.

---

## Keywords

polymarket btc arbitrage bot, polymarket arbitrage trading, polymarket 5 minute btc bot, polymarket 15 minute btc bot, polymarket binary prediction market arbitrage, btc up down trading bot, polymarket beat price arbitrage, polymarket cross-timeframe arbitrage, polymarket automated trading bot, polymarket btc prediction market, polymarket clob arbitrage, btc binary option arbitrage bot, polymarket nodejs bot typescript, prediction market arbitrage strategy, polymarket btc up down 5min 15min
