import pino from "pino";
import type { Settings } from "./config.js";

export function createLogger(settings: Settings) {
  return pino({
    level: settings.logLevel,
    base: { env: settings.environment },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
