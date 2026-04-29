import "dotenv/config";

import { loadSettings } from "./config.js";
import { createLogger } from "./logger.js";
import { ArbBot } from "./bot.js";

async function bootstrap(): Promise<void> {
  const settings = loadSettings();
  const log = createLogger(settings);

  log.info(
    {
      environment: settings.environment,
      wallet:      settings.publicAddress,
      market_5m:   settings.marketId5m,
      market_15m:  settings.marketId15m,
      threshold:   settings.arbThreshold,
    },
    "polymarket_btc_arb_bot_init",
  );

  const bot = new ArbBot(settings, log);

  const shutdown = () => {
    log.info("shutdown_signal_received");
    bot.interrupt();
  };

  process.once("SIGINT",  shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await bot.run();
  } finally {
    log.info("process_exiting");
  }
}

bootstrap().catch((e) => {
  console.error("Fatal startup error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
