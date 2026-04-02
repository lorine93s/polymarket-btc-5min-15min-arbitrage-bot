# Polymarket Trading Bot 
## Market Maker, Liquidity, Copy Trading & Automated Trading Engine

Production-ready **Polymarket trading bot** designed for **market making, liquidity provision, spread capture, and automated trading** on the Polymarket CLOB (Central Limit Order Book).

Built with **TypeScript (Node.js 20+)**, this bot helps traders and developers implement professional **algorithmic trading strategies** on Polymarket prediction markets.

---

## What this bot does

- **Real-time market making** on Polymarket CLOB (Central Limit Order Book)
- **Balanced inventory management** with mirrored YES/NO exposure control
- **Intelligent quote placement** around mid-price using spread (basis points) and orderbook data
- **Optimized cancel/replace** cycles with configurable intervals (aligned with typical taker-delay style timing)
- **Passive execution intent** — quotes are placed as limit-style orders; the design favors maker flow and avoids unnecessary crossing when configured conservatively
- **Risk management** — exposure limits, position size caps, and inventory skew checks before placing orders
- **Auto-redeem** — optional redemption of settled positions above a USD threshold (REST integration)
- **Batch operations** — optional batch cancellation to reduce API round-trips (configurable)
- **Real-time orderbook updates** via WebSocket when market discovery mode is enabled
- **Observability** — Prometheus metrics endpoint and structured JSON logs (Pino)

---

## Core features

### Inventory balance and exposure control

- **Mirrored YES/NO positioning** — Maintains balanced exposure across both sides (within configured limits)
- **Net exposure limits** — Configurable min/max exposure in USD
- **Inventory skew detection** — Risk layer checks skew before trading
- **Quote sizing** — Base size adjusted by inventory and exposure headroom
- **Target inventory balance** — Configurable neutral or biased target via `TARGET_INVENTORY_BALANCE`

### Spread farming efficiency

- **Spread-based quoting** — Mid price from best bid/ask; bid/ask derived from `MIN_SPREAD_BPS`
- **Passive-first design** — Orders are placed off mid with spread; tune size and refresh to stay passive
- **Cancel/replace cadence** — Refreshes quotes on a timer and replaces stale orders
- **Stale order cancellation** — Orders older than `ORDER_LIFETIME_MS` can be batched-cancelled

### Cancel/replace cadence

- **Configurable refresh** — `QUOTE_REFRESH_RATE_MS` (default 1000ms)
- **Taker-delay style tuning** — `TAKER_DELAY_MS` / `CANCEL_REPLACE_INTERVAL_MS` (default 500ms) for loop timing
- **Batch cancellations** — `BATCH_CANCELLATIONS` groups cancels when supported by the API path used
- **Stale order detection** — Based on order timestamps vs `ORDER_LIFETIME_MS`

### Market discovery and real-time updates

- **Discovery mode** — When enabled, loads active markets and resolves your configured `MARKET_ID`
- **Direct mode** — When discovery is off, loads market metadata for `MARKET_ID` via REST
- **WebSocket orderbook** — Subscribes to L2-style updates for the active market when discovery is enabled
- **REST fallbacks** — Orderbook and market info via HTTP when needed

`DISCOVERY_WINDOW_MINUTES` is available in config for future or external tooling; the core loop keys off `MARKET_ID` and active market lists.

### Risk management

- **Exposure limits** — Hard caps via `MAX_EXPOSURE_USD` / `MIN_EXPOSURE_USD`
- **Position size limits** — `MAX_POSITION_SIZE_USD` per validation pass
- **Inventory skew limits** — `INVENTORY_SKEW_LIMIT`
- **Stop-loss** — `STOP_LOSS_PCT` present in config (extend strategy logic if you need it enforced end-to-end)
- **Pre-trade validation** — `RiskManager` validates before each quote

### Auto-redeem and gas-related settings

- **Automatic redemption** — Polls redeemable positions and redeems above `REDEEM_THRESHOLD_USD` when enabled
- **Gas-oriented flags** — `GAS_BATCHING_ENABLED`, `GAS_PRICE_GWEI` in config for workflows that use on-chain operations alongside trading
- **Efficient cancel paths** — Prefer batch cancel when `BATCH_CANCELLATIONS=true`

### Performance monitoring

- **Prometheus** — HTTP `/metrics` (default port 9305)
- **Structured JSON logging** — Pino; suitable for aggregation and audit trails
- **Metric series** — Orders, inventory, exposure, spread, profit, quote latency (see below)

---

## Technical architecture

```
┌─────────────────────┐      ┌──────────────────────┐      ┌──────────────────┐
│ Polymarket CLOB API │      │ Market Maker Bot     │      │ Inventory Mgr    │
│ (REST + WebSocket)  │ <--> │ (Quote Engine)       │ <--> │ (Balance Ctrl)   │
└─────────────────────┘      └──────────────────────┘      └──────────────────┘
         │                           │                            │
         │                           v                            │
         │                  ┌──────────────────┐                 │
         │                  │ Order Executor   │                 │
         │                  │ (Cancel/Replace) │                 │
         │                  └──────────────────┘                 │
         │                           │                            │
         v                           v                            v
┌─────────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ WebSocket Feed      │      │ Risk Manager     │      │ Auto Redeem      │
│ (Orderbook/Trades)  │      │ (Validations)    │      │ (Settlements)    │
└─────────────────────┘      └──────────────────┘      └──────────────────┘
```

---

## Key modules (TypeScript)

| Module | Role |
|--------|------|
| `src/config.ts` | Zod-validated environment settings |
| `src/logger.ts` | Pino JSON logging |
| `src/polymarket/restClient.ts` | REST client (markets, book, orders, balances) |
| `src/polymarket/websocketClient.ts` | WebSocket client (subscribe / listen / reconnect) |
| `src/polymarket/orderSigner.ts` | Ethereum signing for orders (ethers) |
| `src/inventory/inventoryManager.ts` | Inventory and exposure helpers |
| `src/marketMaker/quoteEngine.ts` | Quote generation (spread, sizing) |
| `src/execution/orderExecutor.ts` | Place / cancel / batch cancel |
| `src/risk/riskManager.ts` | Pre-trade risk checks |
| `src/services/autoRedeem.ts` | Redeem flow via REST |
| `src/services/metrics.ts` | Prometheus registry and `/metrics` server |
| `src/bot.ts` | Main market-making loop and lifecycle |
| `src/main.ts` | Entrypoint, signals, metrics bootstrap |

---

## Quick start

### 1) Prerequisites

- **Node.js 20+**
- **npm** (or compatible client)
- Polygon-funded wallet and Polymarket `PRIVATE_KEY` / `MARKET_ID`

### 2) Install

```bash
git clone https://github.com/your-org/polymarket-market-maker-bot.git
cd polymarket-market-maker-bot
npm install
npm run build
```

### 3) Configure `.env`

```bash
copy .env.example .env
```

Minimum:

```env
PRIVATE_KEY=0xYOUR_PRIVATE_KEY
MARKET_ID=0xYOUR_MARKET_ID
```

`.env.example` also includes recommended defaults for size, spread, risk, and timing. You can keep them for a first run, then tune.

### 4) Run

```bash
npm start
```

Development (TypeScript directly):

```bash
npm run dev
```

---

## Common setup errors

- **Invalid CONFIG at startup** — `.env` missing or required keys unset; fix `PRIVATE_KEY` and `MARKET_ID` first.
- **No quotes** — Confirm the market is active, `MARKET_ID` is correct, and REST returns a sensible orderbook (`best_bid` / `best_ask`).
- **WebSocket issues** — Check `POLYMARKET_WS_URL` and network/firewall rules.

---

## Safety notes

- Start with small `DEFAULT_SIZE` and tight exposure caps.
- Never commit real private keys.
- Paper-test logic and logs before scaling size.

---

## Parameter tuning guide

### Inventory balance

- **MAX_EXPOSURE_USD / MIN_EXPOSURE_USD** — Set from capital and risk tolerance; smaller = tighter control.
- **INVENTORY_SKEW_LIMIT** — e.g. `0.3` ≈ 30% max skew before risk rejects (tune to your style).
- **TARGET_INVENTORY_BALANCE** — `0` neutral; positive/negative for directional bias in sizing behavior.

### Spread farming

- **MIN_SPREAD_BPS** — Minimum spread width (10 bps = 0.1%).
- **QUOTE_STEP_BPS** — Step size between levels (reserved for extensions).
- **DEFAULT_SIZE** — Base notional; scale with depth and liquidity.

### Cancel/replace timing

- **CANCEL_REPLACE_INTERVAL_MS** — Loop sleep between refresh passes (default 500ms).
- **QUOTE_REFRESH_RATE_MS** — Minimum time between quote refreshes (default 1000ms).
- **ORDER_LIFETIME_MS** — Stale order age before cancel (default 3000ms).

### Performance-oriented flags

- **BATCH_CANCELLATIONS** — `true` to prefer batch cancel endpoint when applicable.
- **AUTO_REDEEM_ENABLED** — `true` to run periodic redeem passes.
- **GAS_BATCHING_ENABLED** — For strategies combining on-chain ops with API trading.

---

## Monitoring and observability

### Prometheus metrics

Scrape URL (default): `http://localhost:9305/metrics`

Key series (names may vary slightly by version; inspect `/metrics`):

- `pm_mm_orders_placed_total` — Orders placed (labels: side, outcome)
- `pm_mm_orders_filled_total` — Fills (when wired to your feed)
- `pm_mm_inventory` — Inventory gauges
- `pm_mm_exposure_usd` — Net exposure
- `pm_mm_spread_bps` — Spread
- `pm_mm_profit_usd` — Profit tracker
- `pm_mm_quote_latency_ms` — Latency histogram

### Structured logging

Logs are JSON (Pino). Typical topics: quotes placed/cancelled, risk rejections, websocket lifecycle, auto-redeem.

Example shape:

```json
{
  "level": 30,
  "msg": "quote_placed",
  "outcome": "YES",
  "side": "BUY",
  "price": 0.65,
  "size": 100,
  "order_id": "0x..."
}
```

---

## Performance benchmarks (indicative)

Targets depend on network, API limits, and market. Order-of-magnitude expectations often discussed for similar bots:

| Metric | Typical target range |
|--------|----------------------|
| Quote refresh | Sub-100ms locally; end-to-end includes API RTT |
| Cancel/replace cycle | ~500–1000ms (configurable) |
| WebSocket RTT | Highly network-dependent |
| Inventory skew | Below your `INVENTORY_SKEW_LIMIT` |

Treat these as goals, not guarantees.

---

## Who this is for

People searching for: Polymarket market maker bot, Polymarket trading bot, CLOB market making, Polymarket automated trading, prediction market liquidity tools.

Suited to: professional market makers, systematic traders, and builders who want a **TypeScript** codebase they can extend (multi-market, dynamic spreads, ML sizing, portfolio risk, etc.).

---

## Risk management best practices

1. Start small: low `DEFAULT_SIZE` and conservative exposure caps.
2. Monitor inventory and skew continuously.
3. Set exposure limits that match worst-case moves.
4. Validate on small notional before scaling.
5. Watch gas and API rate limits if you add on-chain workflows.
6. Read logs for risk rejections and connectivity issues.

---

## Common issues and troubleshooting

### Orders not filling

- Spread too wide or too narrow vs the book — tune `MIN_SPREAD_BPS`.
- Confirm REST orderbook and websocket (if used) show consistent top of book.
- Queue position: you may be behind larger makers.

### High inventory skew

- Tighten `MAX_EXPOSURE_USD` / `MIN_EXPOSURE_USD`.
- Lower size or increase skew sensitivity via config and logic.

### Excessive costs or API load

- Increase `QUOTE_REFRESH_RATE_MS` / `CANCEL_REPLACE_INTERVAL_MS`.
- Use `BATCH_CANCELLATIONS=true` where supported.

### WebSocket disconnections

- Client reconnects with backoff; check stability of `POLYMARKET_WS_URL` and local network.

---

## Future enhancements

- Multi-market quoting
- Dynamic spread from volatility or orderbook pressure
- ML-assisted sizing
- Portfolio-level risk across markets
- Deeper fill and position sync from user channel / trades feed

---

Optimized for:

* Polymarket market maker bot strategies
* automated trading on prediction markets
* liquidity provision bots
* spread capture trading
* systematic trading infrastructure
* Polymarket copy trading extensions
* high-frequency quote refresh strategies

---

## Keywords (SEO)

polymarket trading bot, polymarket market maker bot, polymarket liquidity bot, polymarket clob bot, polymarket automated trading bot, polymarket market making strategy, prediction market trading bot, polymarket algorithmic trading, polymarket API trading bot, polymarket copy trading bot, crypto prediction market bot

---

## License

Use at your own risk. Market-making involves capital risk and requires understanding prediction markets and Polymarket’s rules.

Ensure compliance with local regulations and [Polymarket’s terms of service](https://polymarket.com) before production use.

---

## Safety and compliance

- This bot can place **real orders** when configured with live keys and funded accounts.
- Inventory and adverse selection risk are real; monitor continuously.
- On-chain costs matter when you combine redemption or transfers with trading.
- Keep audit logs and respect automated-trading and API policies.
