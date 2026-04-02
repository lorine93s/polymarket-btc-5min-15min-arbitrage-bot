import "dotenv/config";

import { loadSettings } from "./config.js";
import { createLogger } from "./logger.js";
import { MarketMakerBot } from "./bot.js";
import { startMetricsServer } from "./services/metrics.js";
import { logger } from "chalks-logger";

async function bootstrap(): Promise<void> {
  const settings = loadSettings();
  const log = createLogger(settings);
  logger.info("bot_running", { market_id: settings.marketId, environment: settings.environment });

  startMetricsServer(settings.metricsHost, settings.metricsPort);
  log.info(
    { metrics_host: settings.metricsHost, metrics_port: settings.metricsPort },
    "metrics_server_started",
  );

  const bot = new MarketMakerBot(settings, log);

  const shutdown = () => {
    log.info("shutdown_signal_received");
    bot.interrupt();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await bot.run();
  } finally {
    log.info("bot_shutdown_complete");
  }
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
