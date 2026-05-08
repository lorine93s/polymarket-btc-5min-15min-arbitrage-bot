# Polymarket Trading Bot (BTC 5m / 15m) — CLOB Arbitrage / Automation (TypeScript)

**Polymarket trading bot** for short-horizon crypto prediction markets (BTC, ETH, SOL, XRP) — built with **Node.js 20+** and **TypeScript**.
If you are searching for **“Polymarket trading bot”**, **“Polymarket arbitrage bot”**, **“Polymarket BTC 5 minute bot”**, or **“Polymarket CLOB bot”**, this repo is a practical starting point.

This bot trades **Polymarket Up/Down markets** on the **Polymarket CLOB (order book)** using the official **`@polymarket/clob-client-v2`** SDK.
It runs **one market window at a time** (configured by coin + period, e.g. **BTC 5m** or **BTC 15m**), polls prices, applies **rule-based entry/exit strategies**, and places orders with **retries, cooldowns, and operator-friendly logging**.
This is **automation scaffolding** for experimentation and operations — **not** a promise of “risk-free arbitrage” profits.

[![Node.js](https://img.shields.io/badge/node-%3E%3D20.6-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-ISC-lightgrey)](#license)

---

## Table of contents

- [What this bot does](#what-this-bot-does)
- [Who this is for](#who-this-is-for)
- [How it differs from “classic” two-window arbitrage](#how-it-differs-from-classic-two-window-arbitrage)
- [Architecture](#architecture)
- [Key modules](#key-modules)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [trade.toml reference](#tradetoml-reference)
- [Operations and risk management](#operations-and-risk-management)
- [Troubleshooting](#troubleshooting)
- [Safety and compliance](#safety-and-compliance)
- [FAQ](#faq)
- [Keywords](#keywords-for-search--github-discovery)

---

## What this bot does

- **Market selection** — Builds Polymarket slugs from `[market].market_coin` and `[market].market_period` (e.g. **BTC + 5m** or **BTC + 15m** short markets).
- **Pricing** — Polls **Gamma / CLOB**-backed pricing for **UP** and **DOWN** outcome tokens.
- **Strategies** — Runs **`trade_1`** or **`trade_2`** rules from `trade.toml` (time/price exits, range entries, optional emergency swap after a sell).
- **Execution** — Submits **market-style orders** via the v2 CLOB client with **instant retries only for transient errors**, **entry cooldown** after failed buys, and **friendly error summaries** (no raw stack spam).
- **Auth** — **L1** wallet signing to **derive or create** API credentials, then **L2** authenticated client for balance and orders.
- **Operator UX** — Startup **banner**, structured logging (**`emojiprint-logger`**), and **trend / position** legends in the console.

If you are looking specifically for a **synchronized dual-window (5m + 15m) paired-leg arbitrage engine**, that is **not** what this codebase implements today; see [How it differs](#how-it-differs-from-classic-two-window-arbitrage).
This repo is still in the same “**Polymarket arbitrage bot / Polymarket trading bot**” category people search for: **Polymarket BTC 5 minute**, **Polymarket BTC 15 minute**, and **Polymarket CLOB trading bot TypeScript**.

---

## Who this is for

- Developers building or extending a **Polymarket CLOB trading bot** in **TypeScript**.
- Traders experimenting with **short-duration Up/Down markets** (e.g. **5m / 15m**) on Polymarket with **small size** and **strict risk controls**.
- Anyone evaluating **arbitrage-adjacent** or **rule-based** automation on **Polymarket prediction markets** (not only directional “picks”).

---

## How it differs from “classic” two-window arbitrage

Many guides describe **cross-window** ideas (e.g. comparing **5-minute** and **15-minute** BTC markets at once, synchronized `endTime`, paired legs). **This repo** instead:

- Trades **one window per running config** (`market_period` = `5`, `15`, `60`, etc.).
- Uses **transparent `trade.toml`** thresholds (ratios, ranges) rather than a hard-coded dual-leg arbitrage engine.

You can **run two processes** with two configs (e.g. one `market_period = "5"`, one `"15"`) as a **future operational pattern**; that is not bundled as a single orchestrated binary here.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    index.ts (bootstrap + banner)                 │
│  CLOB L1 → derive/create API key → CLOB L2 client               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Market loop (per window slug)                                   │
│  • Gamma: resolve market + token IDs                             │
│  • Prices: poll quotes for UP / DOWN                             │
│  • Trade.updatePrices → make_trading_decision                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Strategy (trade_1 | trade_2)              trade/decision.ts    │
│  • Entry gates, exits, optional emergency swap                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Orders + balances                     trade/trade.ts             │
│  • createAndPostMarketOrder (FAK)                                │
│  • Retry policy (utils/retry.ts) + trading errors (human text)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key modules

| Area | Path | Role |
|------|------|------|
| Entry | `src/index.ts` | Banner, CLOB auth, market loop, `Trade` lifecycle |
| CLOB / wallet | `src/services/clob.ts` | Host, chain, signer, funder, signature type |
| Gamma API | `src/services/gamma.ts` | Market metadata by slug |
| Config | `src/config/toml.ts`, `src/config/env.ts`, `src/config/validateEnv.ts` | Zod-validated `trade.toml`, `.env` (with early startup validation) |
| Slug | `src/config/slug.ts` | Coin + period → Polymarket slug |
| Decision | `src/trade/decision.ts` | `trade_1` / `trade_2` branching |
| Prices | `src/trade/prices.ts` | Quote polling and status lines |
| Execution | `src/trade/trade.ts` | Buys/sells, cooldowns, balance waits |
| Errors | `src/utils/tradingErrorMessage.ts`, `retry.ts` | Operator-friendly messages |
| SDK noise | `src/utils/suppressClobConsole.ts` | Quiet CLOB `console.error` during key setup |

---

## Quick start

### Prerequisites

- **Node.js ≥ 20.6**
- **Polygon** wallet with Polymarket-compatible setup (**private key** + **funder / proxy deposit address** as required by your account type)
- Small **USDC** balance appropriate for **`trade_usd`** experiments

### 1. Clone and install

```bash
git clone https://github.com/lorine93s/polymarket-btc-5min-15min-arbitrage-bot.git
cd polymarket-btc-5min-15min-arbitrage-bot
npm install
```

### 2. Environment

Copy `.env.example` to `.env` and fill in secrets (**never commit `.env`**).
The bot validates required env values on startup and will show a clear warning if your **private key** or **funder address** is missing/invalid.

### 3. Strategy and market

Edit **`trade.toml`**:

- Set **`[market].market_period`** to **`"5"`** or **`"15"`** for **Polymarket 5 minute** or **15 minute** BTC (or other coin) windows.
- Choose **`strategy`** = `trade_1` or `trade_2`.
- Set **`trade_usd`**, **`max_retries`**, **`entry_buy_cooldown_sec`**.

### 4. Run

```bash
# Development
npm run dev

# Production-style
npm run build
npm start
```

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POLYMARKET_PRIVATE_KEY` | Yes | Wallet private key used to sign CLOB L1 / L2 operations |
| `POLYMARKET_FUNDER_ADDRESS` | Yes | Funder / deposit (proxy) address that holds trading collateral |
| `PROXY_WALLET_ADDRESS` | Alternate | **Alias**: accepted by the loader if `POLYMARKET_FUNDER_ADDRESS` is unset |
| `POLYMARKET_SIGNATURE_TYPE` | No | `EOA` · `POLY_PROXY` · `POLY_GNOSIS_SAFE` · `POLY_1271`. Defaults to proxy-friendly behavior when omitted |

See **`.env.example`** for commented templates.

**Related queries:** *Polymarket API credentials*, *Polymarket CLOB wallet setup*, *Polymarket trading bot environment variables*, *Polymarket private key invalid byteslike*.

---

## trade.toml reference

| Key | Meaning |
|-----|--------|
| `strategy` | `trade_1` or `trade_2` |
| `trade_usd` | Notional per buy (USD) |
| `max_retries` | Transient-error retries (network / 5xx / 429) |
| `entry_buy_cooldown_sec` | Pause before retrying **entry** after a failed buy |
| `[market].market_coin` | `btc`, `eth`, `sol`, `xrp` |
| `[market].market_period` | `5`, `15`, `60`, `240`, `1440` |
| `[trade_1]`, `[trade_2]` | Strategy parameters (see Zod schema in `src/config/toml.ts`) |

To emphasize **Polymarket BTC 5 minute** vs **Polymarket BTC 15 minute**, change only **`market_period`** (and optionally `market_coin`).

---

## Operations and risk management

- Start with **low `trade_usd`** and verify **fills**, **balances**, and **logs**.
- **Execution risk** remains: partial fills, API errors, and fast-moving **5m / 15m** books can move against you between signal and fill.
- **`entry_buy_cooldown_sec`** reduces tight loops when a failure is **not** transient (e.g. credential / signing issues).
- Prefer a **dedicated wallet** and balance you can afford to lose.

---

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| `Could not derive api key` (suppressed raw log) | Normal on first run; bot should **create** a key next. If both fail: wallet / signature type / Polymarket account. |
| L2 / HMAC / `ERR_INVALID_ARG_TYPE` | Incomplete **API credentials** on the client (e.g. missing secret). Re-run auth; verify client is constructed with full `creds` after L1. |
| No trades | `trade_2` **entry** gates (time ratio + price range); **`hasBought`**; **`entryBuyCooldownUntil`** after failures. |
| Auth / 401 | Funder vs signer mismatch, wrong **`POLYMARKET_SIGNATURE_TYPE`**, or blocked API access. |

---

## Safety and compliance

- This software **places real orders** when configured with live keys and a funded account.
- **No warranty**. Past or hypothetical **arbitrage** edges do not guarantee future results.
- Comply with **local laws**, **Polymarket Terms of Service**, and eligibility rules in your jurisdiction.
- **Never** commit private keys or paste them into support chats.

---

## FAQ

**Is this a “risk-free Polymarket arbitrage bot”?**  
No automated strategy is risk-free. This project automates **rules and execution**; **slippage**, **failed legs**, and **operational bugs** can lose money.

**Is this specifically a Polymarket BTC 5 minute market bot?**  
You configure **`market_period = "5"`** (and `market_coin = "btc"`) for that use case. The same code path supports **15m** and other periods.

**Does it run Polymarket WebSocket feeds?**  
The core loop described here uses **polling** for prices; dependencies may include WS-oriented packages for future extension — check `src/` for actual usage.

**Can I use it for ETH / SOL Polymarket markets?**  
Yes — set **`market_coin`** in `trade.toml`.

---

## Keywords

Common search terms this repo targets:

`polymarket trading bot`, `polymarket arbitrage bot`, `polymarket btc trading bot`, `polymarket btc arbitrage bot`, `polymarket clob bot`, `polymarket clob trading bot`, `polymarket orderbook bot`, `@polymarket/clob-client-v2`, `polymarket api key`, `polymarket market making bot`, `polymarket up down bot`, `polymarket 5 minute bot`, `polymarket 5m btc`, `polymarket 15 minute bot`, `polymarket 15m btc`, `polymarket typescript bot`, `polymarket nodejs bot`, `prediction market trading bot`, `crypto prediction market bot`

---

## License

ISC — see [`package.json`](package.json). Use at your own risk.
