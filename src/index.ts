import { ClobClient, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { generateMarketSlug } from "./config";
import type { Coin, MarketConfig, Minutes } from "./types";
import { getCurrentTime } from "./utils";
import { describeTradingError } from "./utils/tradingErrorMessage";
import { loadConfig } from "./config/toml";
import { logger } from "emojiprint-logger";
import { Trade } from "./trade";
import { runWithClobSdkErrorsSuppressed } from "./utils/suppressClobConsole";
import { validateEnv } from "./config/validateEnv";

loadConfig();

const marketConfig: MarketConfig = {
  coin: globalThis.__CONFIG__.market.market_coin as Coin, // btc / eth / sol / xrp
  minutes: parseInt(globalThis.__CONFIG__.market.market_period) as Minutes, // 15 / 60 / 240 / 1440
};

function logStartupBanner() {
  const coin = marketConfig.coin.toUpperCase();
  const bar = "━".repeat(54);
  console.info(bar);
  console.info(`  POLYMARKET  ·  ${coin}  ·  ${marketConfig.minutes}m  ·  ARBITRAGE BOT`);
  console.info(bar);
}

async function main() {
  logStartupBanner();

  const envValidation = validateEnv();
  if (!envValidation.ok) {
    logger.warn("⚠️ Missing or invalid environment variables:");
    for (const msg of envValidation.messages) {
      logger.warn(`- ${msg}`);
    }
    logger.warn("Please update your `.env` file (see `.env.example`) and run again.");
    process.exit(1);
  }

  // Delay importing services until env is validated (avoids ethers crashing on bad env).
  const {
    CHAIN_ID,
    FUNDER,
    getMarket,
    getPrices,
    HOST,
    SIGNATURE_TYPE,
    SIGNER,
  } = await import("./services");

  const signerAddress = SIGNER?.address ?? "unknown";
  logger.info(`Public key: ${signerAddress}`);
  logger.info(`Strategy: ${globalThis.__CONFIG__.strategy} | Market: ${marketConfig.coin.toUpperCase()} ${marketConfig.minutes}m | Trade USD: $${globalThis.__CONFIG__.trade_usd}`);
  logger.info("Trend legend: UP 🟢 | DOWN 🔴 | FLAT ⚪");
  logger.info("Position legend: UP 🟩 | DOWN 🟥 | NONE ⬛");
  const configuredSignatureType = process.env.POLYMARKET_SIGNATURE_TYPE?.trim();
  const signatureCandidates = configuredSignatureType
    ? [SIGNATURE_TYPE]
    : [SignatureTypeV2.POLY_PROXY, SignatureTypeV2.EOA];

  let apiKey: Awaited<ReturnType<ClobClient["createOrDeriveApiKey"]>> | null = null;
  let activeSignatureType: SignatureTypeV2 = SIGNATURE_TYPE;
  let lastAuthError: unknown = null;

  for (const candidate of signatureCandidates) {
    try {
      const clientConfig: ConstructorParameters<typeof ClobClient>[0] = {
        host: HOST,
        chain: CHAIN_ID,
        signer: SIGNER,
        signatureType: candidate,
      };
      // For proxy/safe-style setups the funded wallet is required; for EOA it should be omitted.
      if (candidate !== SignatureTypeV2.EOA) {
        clientConfig.funderAddress = FUNDER;
      }
      const clobClient = new ClobClient(clientConfig);
      try {
        apiKey = await runWithClobSdkErrorsSuppressed(() => clobClient.deriveApiKey());
      } catch (deriveErr) {
        const { kind, why } = describeTradingError(deriveErr);
        logger.info(`${kind}: ${why}`);
        apiKey = await runWithClobSdkErrorsSuppressed(() => clobClient.createApiKey());
      }
      activeSignatureType = candidate;
      logger.info(`Authenticated CLOB with signature type: ${SignatureTypeV2[candidate]}`);
      break;
    } catch (error) {
      lastAuthError = error;
      logger.warn(`Auth failed for signature type ${SignatureTypeV2[candidate]}, trying next...`);
    }
  }

  if (!apiKey) {
    const { kind, why } = describeTradingError(lastAuthError);
    throw new Error(`${kind}: ${why}`);
  }

  while (true) {
    const client = new ClobClient(
      {
        host: HOST,
        chain: CHAIN_ID,
        signer: SIGNER,
        creds: apiKey, // Generated from L1 auth, API credentials enable L2 methods
        signatureType: activeSignatureType,
        ...(activeSignatureType !== SignatureTypeV2.EOA ? { funderAddress: FUNDER } : {}),
      }
    );
    const { slug, endTimestamp } = generateMarketSlug(marketConfig.coin, marketConfig.minutes);

    logger.warn(`Market selected: ${slug}`);
    logger.info(`Window: ${getCurrentTime()} -> ${endTimestamp}`);

    const market = await getMarket(slug);

    const upTokenId = JSON.parse(market.clobTokenIds)[0];
    const downTokenId = JSON.parse(market.clobTokenIds)[1];
    const usd = globalThis.__CONFIG__.trade_usd;

    const trade = new Trade
      (
        usd,
        upTokenId,
        downTokenId,
        client
      );

    while (true) {

      getPrices(upTokenId, downTokenId)
        .then(async e => {

          trade.updatePrices(endTimestamp - getCurrentTime(), e[upTokenId].BUY, e[upTokenId].SELL, e[downTokenId].BUY, e[downTokenId].SELL);
          await trade.make_trading_decision();
        })
        .catch((e) => {
          const { kind, why } = describeTradingError(e);
          logger.warn(`🔔 Market loop | ${kind}: ${why}`);
        });

      await new Promise(resolve => setTimeout(resolve, 1000));


      if (endTimestamp - getCurrentTime() <= 0) {
        break;
      }
    }
  }

}

main().catch((error: unknown) => {
  const { kind, why } = describeTradingError(error);
  logger.error(`Fatal — ${kind}: ${why}`);
  process.exit(1);
});
