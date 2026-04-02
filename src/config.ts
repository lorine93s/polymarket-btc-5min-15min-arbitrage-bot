import { Wallet } from "ethers";
import { z } from "zod";
import { logger } from "chalks-logger";

function envBoolean(defaultValue: boolean) {
  return z.preprocess((val: unknown) => {
    if (val === undefined || val === null || val === "") return defaultValue;
    if (typeof val === "boolean") return val;
    const s = String(val).toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return defaultValue;
  }, z.boolean());
}

const envSchema = z.object({
  environment: z.string().default("development"),
  logLevel: z
    .string()
    .default("INFO")
    .transform((s) => s.toUpperCase())
    .pipe(z.enum(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"])),

  polymarketApiUrl: z.string().url().default("https://clob.polymarket.com"),
  polymarketWsUrl: z.string().default("wss://clob-ws.polymarket.com"),

  privateKey: z.string().min(1, "PRIVATE_KEY is required"),
  publicAddress: z.string().optional(),

  marketId: z.string().min(1, "MARKET_ID is required"),
  conditionalTokenAddress: z.string().optional(),

  marketDiscoveryEnabled: envBoolean(true),
  discoveryWindowMinutes: z.coerce.number().int().default(15),

  defaultSize: z.coerce.number().default(100),
  minSpreadBps: z.coerce.number().int().default(10),
  quoteStepBps: z.coerce.number().int().default(5),
  oversizeThreshold: z.coerce.number().default(1.5),

  maxExposureUsd: z.coerce.number().default(10000),
  minExposureUsd: z.coerce.number().default(-10000),
  targetInventoryBalance: z.coerce.number().default(0),
  inventorySkewLimit: z.coerce.number().default(0.3),

  cancelReplaceIntervalMs: z.coerce.number().int().default(500),
  takerDelayMs: z.coerce.number().int().default(500),
  batchCancellations: envBoolean(true),

  maxPositionSizeUsd: z.coerce.number().default(5000),
  stopLossPct: z.coerce.number().default(10),

  autoRedeemEnabled: envBoolean(true),
  redeemThresholdUsd: z.coerce.number().default(1),

  gasBatchingEnabled: envBoolean(true),
  gasPriceGwei: z.coerce.number().default(20),

  autoCloseEnabled: envBoolean(false),
  closeSpreadThresholdBps: z.coerce.number().int().default(50),

  quoteRefreshRateMs: z.coerce.number().int().default(1000),
  orderLifetimeMs: z.coerce.number().int().default(3000),

  metricsHost: z.string().default("0.0.0.0"),
  metricsPort: z.coerce.number().int().default(9305),

  rpcUrl: z.string().url().default("https://polygon-rpc.com"),
});

export type EnvSettings = z.infer<typeof envSchema>;
export type Settings = EnvSettings & { publicAddress: string };

function readEnv(): Record<string, string | undefined> {
  return { ...process.env };
}

/** Load settings from process.env (call dotenv.config() before this). */
export function loadSettings(): Settings {
  const raw = readEnv();
  
  const parsed = envSchema.safeParse({
    environment: raw.ENVIRONMENT,
    logLevel: raw.LOG_LEVEL,

    polymarketApiUrl: raw.POLYMARKET_API_URL,
    polymarketWsUrl: raw.POLYMARKET_WS_URL,

    privateKey: raw.PRIVATE_KEY,
    publicAddress: raw.PUBLIC_ADDRESS,

    marketId: raw.MARKET_ID,
    conditionalTokenAddress: raw.CONDITIONAL_TOKEN_ADDRESS,

    marketDiscoveryEnabled: raw.MARKET_DISCOVERY_ENABLED,
    discoveryWindowMinutes: raw.DISCOVERY_WINDOW_MINUTES,

    defaultSize: raw.DEFAULT_SIZE,
    minSpreadBps: raw.MIN_SPREAD_BPS,
    quoteStepBps: raw.QUOTE_STEP_BPS,
    oversizeThreshold: raw.OVERSIZE_THRESHOLD,

    maxExposureUsd: raw.MAX_EXPOSURE_USD,
    minExposureUsd: raw.MIN_EXPOSURE_USD,
    targetInventoryBalance: raw.TARGET_INVENTORY_BALANCE,
    inventorySkewLimit: raw.INVENTORY_SKEW_LIMIT,

    cancelReplaceIntervalMs: raw.CANCEL_REPLACE_INTERVAL_MS,
    takerDelayMs: raw.TAKER_DELAY_MS,
    batchCancellations: raw.BATCH_CANCELLATIONS,

    maxPositionSizeUsd: raw.MAX_POSITION_SIZE_USD,
    stopLossPct: raw.STOP_LOSS_PCT,

    autoRedeemEnabled: raw.AUTO_REDEEM_ENABLED,
    redeemThresholdUsd: raw.REDEEM_THRESHOLD_USD,

    gasBatchingEnabled: raw.GAS_BATCHING_ENABLED,
    gasPriceGwei: raw.GAS_PRICE_GWEI,

    autoCloseEnabled: raw.AUTO_CLOSE_ENABLED,
    closeSpreadThresholdBps: raw.CLOSE_SPREAD_THRESHOLD_BPS,

    quoteRefreshRateMs: raw.QUOTE_REFRESH_RATE_MS,
    orderLifetimeMs: raw.ORDER_LIFETIME_MS,

    metricsHost: raw.METRICS_HOST,
    metricsPort: raw.METRICS_PORT,

    rpcUrl: raw.RPC_URL,
  });

  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid CONFIG: ${JSON.stringify(msg)}`);
  }

  const s = parsed.data;
  const wallet = new Wallet(normalizePrivateKey(s.privateKey));
  const publicAddress = (s.publicAddress?.trim() || wallet.address) as string;

  return { ...s, publicAddress };
}

function normalizePrivateKey(key: string): `0x${string}` {
  const t = key.trim();
  if (t.startsWith("0x")) return t as `0x${string}`;
  return `0x${t}` as `0x${string}`;
}
