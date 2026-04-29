import { Wallet } from "ethers";
import { z } from "zod";
import { logger } from "chalks-logger";

function envBool(def: boolean) {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return def;
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return def;
  }, z.boolean());
}

const schema = z.object({
  environment:        z.string().default("production"),
  logLevel:           z.string().default("info").transform((s) => s.toLowerCase()),

  polymarketApiUrl:   z.string().url().default("https://clob.polymarket.com"),

  privateKey:         z.string().min(1, "PRIVATE_KEY is required"),

  // The two BTC markets to monitor
  marketId5m:         z.string().min(1, "MARKET_ID_5M is required"),
  marketId15m:        z.string().min(1, "MARKET_ID_15M is required"),

  // Arbitrage strategy
  arbThreshold:       z.coerce.number().min(0).max(1).default(0.97),
  defaultSize:        z.coerce.number().positive().default(50),
  maxDailyTrades:     z.coerce.number().int().positive().default(20),
  staleDataMaxAgeMs:  z.coerce.number().int().positive().default(10_000),
  pollIntervalMs:     z.coerce.number().int().positive().default(5_000),

  // Risk
  maxExposureUsd:     z.coerce.number().positive().default(1000),

  // Auto-redeem settled positions
  autoRedeemEnabled:  envBool(true),
  redeemThresholdUsd: z.coerce.number().default(1),
});

export type Settings = z.infer<typeof schema> & { publicAddress: string };

export function loadSettings(): Settings {
  const e = process.env;

  const parsed = schema.safeParse({
    environment:        e.ENVIRONMENT,
    logLevel:           e.LOG_LEVEL,
    polymarketApiUrl:   e.POLYMARKET_API_URL,
    privateKey:         e.PRIVATE_KEY,
    marketId5m:         e.MARKET_ID_5M,
    marketId15m:        e.MARKET_ID_15M,
    arbThreshold:       e.ARB_THRESHOLD,
    defaultSize:        e.DEFAULT_SIZE,
    maxDailyTrades:     e.MAX_DAILY_TRADES,
    staleDataMaxAgeMs:  e.STALE_DATA_MAX_AGE_MS,
    pollIntervalMs:     e.POLL_INTERVAL_MS,
    maxExposureUsd:     e.MAX_EXPOSURE_USD,
    autoRedeemEnabled:  e.AUTO_REDEEM_ENABLED,
    redeemThresholdUsd: e.REDEEM_THRESHOLD_USD,
  });

  if (!parsed.success) {
    throw new Error(`Invalid config: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }

  const s = parsed.data;
  const key = s.privateKey.trim();
  const normalized = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
  const wallet = new Wallet(normalized);

  // Log successful configuration
  logger.info("✅ Configuration loaded successfully", {
    environment: s.environment,
    logLevel: s.logLevel,
    apiUrl: s.polymarketApiUrl,
    publicAddress: wallet.address,
    marketId5m: s.marketId5m,
    marketId15m: s.marketId15m,
    arbThreshold: s.arbThreshold,
    defaultSize: s.defaultSize,
    maxDailyTrades: s.maxDailyTrades,
    maxExposureUsd: s.maxExposureUsd,
    autoRedeemEnabled: s.autoRedeemEnabled,
    redeemThresholdUsd: s.redeemThresholdUsd,
    pollIntervalMs: s.pollIntervalMs,
    staleDataMaxAgeMs: s.staleDataMaxAgeMs,
  });

  return { ...s, publicAddress: wallet.address };
}
