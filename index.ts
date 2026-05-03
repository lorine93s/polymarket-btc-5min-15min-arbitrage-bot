/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║              POLYMARKET BTC 5M/15M ARBITRAGE BOT v1.0.0                     ║
 * ║                   Automated Cross-Market Arbitrage Strategy                  ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 * 
 * 📋 OVERVIEW:
 *    Monitors BTC price movements across 5-minute and 15-minute prediction 
 *    markets on Polymarket, executing arbitrage trades when profitable 
 *    opportunities arise. Implements risk management, auto-redemption, 
 *    and comprehensive logging.
 * 
 * 🚀 QUICK START:
 *    1. Install dependencies:  npm install
 *    2. Configure environment: cp .env.example .env
 *    3. Start the bot:         npm run dev
 * 
 * ⚙️ CONFIGURATION:
 *    All settings are managed through environment variables and interactive
 *    prompts on first run. See ENV_DEFINITIONS for complete parameter list.
 * 
 * 📊 STRATEGY:
 *    - Monitors BTC 5M and 15M YES token order books simultaneously
 *    - Executes arbitrage when combined YES ask price is below threshold
 *    - Implements position sizing, exposure limits, and daily trade caps
 *    - Auto-redeems settled positions to optimize capital efficiency
 * 
 * ⚠️ RISK WARNING:
 *    This bot is for educational purposes. Cryptocurrency and prediction
 *    market trading involves substantial risk. Only trade with capital
 *    you can afford to lose. Past performance doesn't guarantee future results.
 * 
 * @author Polymarket Arbitrage Team
 * @license MIT
 * @version 1.0.0
 */

import "dotenv/config";
import chalk from "chalk";
import inquirer from "inquirer";
import { logger } from "emojiprint-logger"
import { Wallet, isHexString } from "ethers";
import { ClobClient } from "@polymarket/clob-client";

// ─── Type Definitions ────────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";
type EnvCategory = "Required" | "Strategy" | "Risk" | "Timing" | "Auto-redeem" | "Optional";

type EnvDefinition = {
  key: string;
  category: EnvCategory;
  description: string;
  defaultValue: string;
  validator: (value: string) => true | string;
  secret?: boolean;
};

type BotConfig = {
  privateKey: string;
  marketId5m: string;
  marketId15m: string;
  arbThreshold: number;
  defaultSize: number;
  maxDailyTrades: number;
  maxExposureUsd: number;
  pollIntervalMs: number;
  staleDataMaxAgeMs: number;
  autoRedeemEnabled: boolean;
  redeemThresholdUsd: number;
  logLevel: LogLevel;
  polymarketApiUrl: string;
  environment: string;
};

type PriceSnapshot = {
  ask: number;
  bid: number;
  updatedAtMs: number;
  marketRef: string;
  yesTokenId?: string;
};

// ─── Constants & Configuration ───────────────────────────────────────────────

const SEPARATOR = "────────────────────────────────────────────────────────────";
const ONE_MINUTE_MS = 60_000;
const DEFAULT_API_URL = "https://clob.polymarket.com";
const APP_VERSION = "1.0.0";

const ENV_DEFINITIONS: EnvDefinition[] = [
  {
    key: "PRIVATE_KEY",
    category: "Required",
    description: "Ethereum wallet private key for signing orders (Polygon network)",
    defaultValue: "",
    secret: true,
    validator: (v) => {
      if (!v) return "Private key is required for transaction signing.";
      if (!isHexString(v, 32)) return "Must be a valid 32-byte hex string (format: 0x...).";
      return true;
    },
  },
  {
    key: "MARKET_ID_5M",
    category: "Required",
    description: "Polymarket condition ID for BTC 5-minute prediction market",
    defaultValue: "0xYOUR_5MIN_MARKET_CONDITION_ID",
    validator: (v) => {
      if (!v) return "Market ID is required to identify the 5-minute market.";
      if (!v.startsWith("0x")) return "Condition ID must begin with '0x' prefix.";
      if (v.toUpperCase().includes("YOUR_")) return "Please replace placeholder with actual market condition ID from Polymarket.";
      return true;
    },
  },
  {
    key: "MARKET_ID_15M",
    category: "Required",
    description: "Polymarket condition ID for BTC 15-minute prediction market",
    defaultValue: "0xYOUR_15MIN_MARKET_CONDITION_ID",
    validator: (v) => {
      if (!v) return "Market ID is required to identify the 15-minute market.";
      if (!v.startsWith("0x")) return "Condition ID must begin with '0x' prefix.";
      if (v.toUpperCase().includes("YOUR_")) return "Please replace placeholder with actual market condition ID from Polymarket.";
      return true;
    },
  },
  {
    key: "ARB_THRESHOLD",
    category: "Strategy",
    description: "Maximum combined YES ask price to trigger arbitrage execution",
    defaultValue: "0.97",
    validator: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return "Must be a valid decimal number.";
      if (n <= 0 || n > 1) return "Threshold must be between 0.01 and 1.00 (recommended: 0.95-0.98).";
      return true;
    },
  },
  {
    key: "DEFAULT_SIZE",
    category: "Strategy",
    description: "Number of shares to trade per leg (5M and 15M markets)",
    defaultValue: "50",
    validator: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return "Share count must be a positive integer.";
      return true;
    },
  },
  {
    key: "MAX_DAILY_TRADES",
    category: "Strategy",
    description: "Maximum number of arbitrage trades allowed per UTC day",
    defaultValue: "20",
    validator: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) return "Must be a positive integer (recommended: 10-50).";
      return true;
    },
  },
  {
    key: "MAX_EXPOSURE_USD",
    category: "Risk",
    description: "Maximum cumulative open position exposure in USD across all markets",
    defaultValue: "1000",
    validator: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return "Must be a positive dollar amount.";
      return true;
    },
  },
  {
    key: "POLL_INTERVAL_MS",
    category: "Timing",
    description: "Time between market data polls in milliseconds",
    defaultValue: "5000",
    validator: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 500) return "Must be at least 500ms to avoid rate limiting.";
      return true;
    },
  },
  {
    key: "STALE_DATA_MAX_AGE_MS",
    category: "Timing",
    description: "Maximum acceptable age of market data before skipping trade",
    defaultValue: "10000",
    validator: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) return "Must be a positive millisecond value.";
      return true;
    },
  },
  {
    key: "AUTO_REDEEM_ENABLED",
    category: "Auto-redeem",
    description: "Automatically redeem payouts from settled prediction markets",
    defaultValue: "true",
    validator: (v) => {
      const s = v.toLowerCase();
      if (!["true", "false"].includes(s)) return "Must be 'true' or 'false'.";
      return true;
    },
  },
  {
    key: "REDEEM_THRESHOLD_USD",
    category: "Auto-redeem",
    description: "Minimum payout amount in USD to trigger redemption",
    defaultValue: "1.0",
    validator: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return "Must be a non-negative dollar amount.";
      return true;
    },
  },
  {
    key: "LOG_LEVEL",
    category: "Optional",
    description: "Logging verbosity level for console output",
    defaultValue: "info",
    validator: (v) => {
      const s = v.toLowerCase();
      if (!["debug", "info", "warn", "error"].includes(s)) return "Must be one of: debug, info, warn, error.";
      return true;
    },
  },
  {
    key: "POLYMARKET_API_URL",
    category: "Optional",
    description: "Base URL for Polymarket CLOB API endpoint",
    defaultValue: DEFAULT_API_URL,
    validator: (v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return "Must be a valid HTTPS URL.";
      }
    },
  },
  {
    key: "ENVIRONMENT",
    category: "Optional",
    description: "Runtime environment identifier for logging purposes",
    defaultValue: "production",
    validator: (v) => (v.trim() ? true : "Environment name cannot be empty."),
  },
];

const categoryOrder: EnvCategory[] = ["Required", "Strategy", "Risk", "Timing", "Auto-redeem", "Optional"];
const categoryIcons: Record<EnvCategory, string> = {
  Required: "🔐",
  Strategy: "📈",
  Risk: "⚠️",
  Timing: "⏱️",
  "Auto-redeem": "🔄",
  Optional: "⚙️",
};

// ─── Professional Banner & Display ──────────────────────────────────────────

/**
 * Clears console and displays professional ASCII art banner with 
 * project branding, version information, and strategy description.
 */
function displayProfessionalBanner(): void {
  console.clear();
  logger.info('Polymarket BTC arbitrage bot started runnning...');
  
  console.log(chalk.cyan('╔══════════════════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║') + '                                                                              ' + chalk.cyan('║'));
  console.log(chalk.cyan('║') + '  ' + chalk.yellow.bold('██████╗  ██████╗ ██╗  ██╗██╗   ██╗███╗   ███╗ █████╗ ██████╗ ██╗  ██╗███████╗████████╗') + '  ' + chalk.cyan('║'));
  console.log(chalk.cyan('║') + '  ' + chalk.yellow.bold('██╔══██╗██╔═══██╗██║  ╚██║╚██╗ ██╔╝████╗ ████║██╔══██╗██╔══██╗██║ ██╔╝██╔════╝╚══██╔══╝') + '  ' + chalk.cyan('║'));
  console.log(chalk.cyan('║') + '  ' + chalk.yellow.bold('██████╔╝██║   ██║██║   ╚██╗╚████╔╝ ██╔████╔██║███████║██████╔╝█████╔╝ █████╗     ██║') + '     ' + chalk.cyan('║'));
  console.log(chalk.cyan('║') + '  ' + chalk.yellow.bold('██╔═══╝ ██║   ██║██║   ██╔╝ ╚██╔╝  ██║╚██╔╝██║██╔══██║██╔══██╗██╔═██╗ ██╔══╝     ██║') + '     ' + chalk.cyan('║'));
  console.log(chalk.cyan('║') + '  ' + chalk.yellow.bold('██║     ╚██████╔╝███████╔╝   ██║   ██║ ╚═╝ ██║██║  ██║██║  ██║██║  ██╗███████╗   ██║') + '     ' + chalk.cyan('║'));
  console.log(chalk.cyan('║') + '  ' + chalk.yellow.bold('╚═╝      ╚═════╝ ╚══════╝    ╚═╝   ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝') + '     ' + chalk.cyan('║'));
  console.log(chalk.cyan('║') + '                                                                              ' + chalk.cyan('║'));
  console.log(chalk.cyan('║') + '  ' + chalk.white.bold(`BTC 5-Min / 15-Min Arbitrage Bot v${APP_VERSION}`) + '                                        ' + chalk.cyan('║'));
  console.log(chalk.cyan('║') + '  ' + chalk.gray('Automated cross-market arbitrage strategy for Polymarket Prediction Markets') + '   ' + chalk.cyan('║'));
  console.log(chalk.cyan('║') + '                                                                              ' + chalk.cyan('║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════════╝'));
  console.log('');
}

/**
 * Displays formatted configuration summary with all bot parameters
 * organized by category for easy verification before trading starts.
 */
function displayConfigurationSummary(cfg: BotConfig): void {
  console.log(chalk.blue('┌────────────────────────────────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│') + chalk.white.bold('                          CONFIGURATION SUMMARY                              ') + chalk.blue('│'));
  console.log(chalk.blue('├────────────────────────────────────────────────────────────────────────────┤'));
  
  // Environment & Connection
  console.log(chalk.blue('│') + chalk.gray(' Environment  │ ') + chalk.white(cfg.environment.padEnd(15)) + 
              chalk.gray('API Endpoint  │ ') + chalk.white(cfg.polymarketApiUrl.padEnd(30)) + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray(' Log Level    │ ') + chalk.white(cfg.logLevel.toUpperCase().padEnd(15)) + 
              chalk.gray('Paper Trading │ ') + chalk.yellow((process.env.PAPER_TRADING !== 'false' ? 'Enabled ' : 'Disabled').padEnd(30)) + chalk.blue('│'));
  console.log(chalk.blue('├────────────────────────────────────────────────────────────────────────────┤'));
  
  // Strategy Parameters
  console.log(chalk.blue('│') + chalk.white.bold(' STRATEGY PARAMETERS') + '                                                        ' + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  • Arbitrage Threshold   : ') + chalk.yellow(cfg.arbThreshold.toFixed(2)) + 
              chalk.gray('  (Combined YES ask must be ≤ this value)') + '                            ' + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  • Trade Size            : ') + chalk.yellow(`${cfg.defaultSize} shares`) + 
              chalk.gray('  (Number of shares per market leg)') + '                                  ' + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  • Max Daily Trades      : ') + chalk.yellow(`${cfg.maxDailyTrades} trades`) + 
              chalk.gray('  (Trading limit per UTC day)') + '                                       ' + chalk.blue('│'));
  
  // Risk Management
  console.log(chalk.blue('├────────────────────────────────────────────────────────────────────────────┤'));
  console.log(chalk.blue('│') + chalk.white.bold(' RISK MANAGEMENT') + '                                                               ' + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  • Maximum Exposure      : ') + chalk.red(`$${cfg.maxExposureUsd.toLocaleString()}`) + 
              chalk.gray('  (Cumulative open position limit)') + '                                    ' + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  • Auto-Redeem           : ') + chalk.yellow(cfg.autoRedeemEnabled ? 'Enabled ' : 'Disabled') + 
              chalk.gray('  • Redeem Threshold : ') + chalk.green(`$${cfg.redeemThresholdUsd.toFixed(2)}`) + '                        ' + chalk.blue('│'));
  
  // Timing Configuration
  console.log(chalk.blue('├────────────────────────────────────────────────────────────────────────────┤'));
  console.log(chalk.blue('│') + chalk.white.bold(' TIMING CONFIGURATION') + '                                                         ' + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  • Poll Interval         : ') + chalk.cyan(`${cfg.pollIntervalMs}ms`) + 
              chalk.gray('  (Market data refresh rate)') + '                                        ' + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  • Stale Data Threshold  : ') + chalk.cyan(`${cfg.staleDataMaxAgeMs}ms`) + 
              chalk.gray('  (Maximum acceptable data age)') + '                                     ' + chalk.blue('│'));
  
  console.log(chalk.blue('└────────────────────────────────────────────────────────────────────────────┘'));
  console.log('');
}

/**
 * Displays market information and connection status after successful API connection.
 */
function displayMarketInfo(cfg: BotConfig, walletAddress: string): void {
  console.log(chalk.green('┌────────────────────────────────────────────────────────────────────────────┐'));
  console.log(chalk.green('│') + chalk.white.bold('                          CONNECTION ESTABLISHED                             ') + chalk.green('│'));
  console.log(chalk.green('├────────────────────────────────────────────────────────────────────────────┤'));
  console.log(chalk.green('│') + chalk.gray(' Wallet Address : ') + chalk.white(walletAddress) + ' '.repeat(40 - walletAddress.length) + chalk.green('│'));
  console.log(chalk.green('│') + chalk.gray(' Network        : ') + chalk.white('Polygon (Chain ID: 137)') + '                                            ' + chalk.green('│'));
  console.log(chalk.green('│') + chalk.gray(' Protocol       : ') + chalk.white('Polymarket CLOB v4') + '                                                   ' + chalk.green('│'));
  console.log(chalk.green('├────────────────────────────────────────────────────────────────────────────┤'));
  console.log(chalk.green('│') + chalk.white.bold(' MONITORED MARKETS') + '                                                            ' + chalk.green('│'));
  console.log(chalk.green('│') + chalk.gray(' BTC 5-Min  : ') + chalk.white(cfg.marketId5m.substring(0, 50) + '...') + '  ' + chalk.green('│'));
  console.log(chalk.green('│') + chalk.gray(' BTC 15-Min : ') + chalk.white(cfg.marketId15m.substring(0, 50) + '...') + '  ' + chalk.green('│'));
  console.log(chalk.green('└────────────────────────────────────────────────────────────────────────────┘'));
  console.log('');
}

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Returns current timestamp in 24-hour format for consistent log formatting.
 * Format: HH:MM:SS (en-GB locale)
 */
function getTimestamp(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

/**
 * Masks sensitive values for secure display output.
 * Shows first 6 and last 4 characters for values longer than 10 chars.
 * Short values are fully masked with asterisks.
 */
function maskSecret(value: string): string {
  if (!value) return "(not set)";
  if (value.length < 10) return "********";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/**
 * Converts string environment variable to boolean.
 * Accepts: "true"/"false" (case-insensitive)
 */
function asBool(value: string): boolean {
  return value.toLowerCase() === "true";
}

// ─── Logger Class ───────────────────────────────────────────────────────────

/**
 * Professional logging utility with support for multiple severity levels
 * and color-coded console output. Automatically filters messages based on
 * configured log level threshold.
 */
class Logger {
  private readonly level: LogLevel;

  constructor(level: LogLevel) {
    this.level = level;
  }

  /**
   * Determines if a message at the given level should be displayed
   * based on the configured minimum log level.
   */
  private allow(level: LogLevel): boolean {
    const rank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
    return rank[level] >= rank[this.level];
  }

  /**
   * Formats and prints a log message with timestamp, level label, and color.
   */
  private print(level: LogLevel, label: string, color: (text: string) => string, message: string): void {
    if (!this.allow(level)) return;
    const time = chalk.gray(`[${getTimestamp()}]`);
    console.log(`${time} ${color(label)} ${message}`);
  }

  /** Log detailed debugging information for development and troubleshooting */
  debug(message: string): void {
    this.print("debug", "[DEBUG]", chalk.cyan, message);
  }
  
  /** Log general operational information about bot activities */
  info(message: string): void {
    this.print("info", "[INFO ]", chalk.blue, message);
  }
  
  /** Log warning messages for non-critical issues that require attention */
  warn(message: string): void {
    this.print("warn", "[WARN ]", chalk.yellow, message);
  }
  
  /** Log error messages for critical failures and exceptions */
  error(message: string): void {
    this.print("error", "[ERROR]", chalk.red, message);
  }
  
  /** Log successful operations with green indicator */
  success(message: string): void {
    this.print("info", "[ OK  ]", chalk.green, message);
  }
}

// ─── Main Bot Class ─────────────────────────────────────────────────────────

/**
 * PolymarketArbBot - Core arbitrage execution engine
 * 
 * Implements the main trading strategy loop, risk management,
 * position tracking, and automated redemption functionality.
 * Designed for 24/7 operation with graceful shutdown support.
 */
class PolymarketArbBot {
  private readonly logger: Logger;
  private readonly wallet: Wallet;
  private readonly clob: unknown;
  private readonly cfg: BotConfig;
  private running = false;
  private dailyTrades = 0;
  private exposureUsd = 0;
  private utcDay = this.currentUtcDay();
  private pollTimer?: NodeJS.Timeout;
  private redeemTimer?: NodeJS.Timeout;
  private activeOrders = new Set<string>();

  constructor(cfg: BotConfig) {
    this.cfg = cfg;
    this.wallet = new Wallet(cfg.privateKey);
    this.logger = new Logger(cfg.logLevel);
    this.clob = this.createClobClient();
  }

  /**
   * Initializes and starts the bot with connectivity validation,
   * professional startup display, and main trading loops.
   */
  async start(): Promise<void> {
    // Display banner first
    displayProfessionalBanner();
    
    this.logger.info("Initializing Polymarket Arbitrage Bot...");
    this.logger.info("Establishing connection to Polymarket CLOB API...");
    
    // Validate connectivity
    await this.withBackoff(async () => this.ping(), "clob_connectivity_check");
    
    this.logger.success("Connection established successfully");
    this.running = true;

    // Display professional startup information
    displayMarketInfo(this.cfg, this.wallet.address);
    displayConfigurationSummary(this.cfg);
    
    // Show running status
    console.log(chalk.green('┌────────────────────────────────────────────────────────────────────────────┐'));
    console.log(chalk.green('│') + chalk.white.bold('  🚀 BOT STARTED SUCCESSFULLY - Monitoring markets for arbitrage opportunities') + chalk.green('│'));
    console.log(chalk.green('│') + chalk.gray('  Press Ctrl+C to stop the bot gracefully') + '                                  ' + chalk.green('│'));
    console.log(chalk.green('└────────────────────────────────────────────────────────────────────────────┘'));
    console.log('');
    
    this.attachSignalHandlers();
    this.startLoops();
  }

  /**
   * Creates and configures the Polymarket CLOB client instance
   * for Polygon network (Chain ID: 137).
   */
  private createClobClient(): unknown {
    const ClobClientCtor = ClobClient as unknown as new (...args: unknown[]) => unknown;
    const client = new ClobClientCtor(this.cfg.polymarketApiUrl, 137, this.wallet);
    return client;
  }

  /**
   * Tests API connectivity using available methods on the CLOB client.
   * Tries multiple endpoints for maximum compatibility across SDK versions.
   */
  private async ping(): Promise<void> {
    const client = this.clob as Record<string, (...args: unknown[]) => Promise<unknown>>;
    
    if (typeof client.getServerVersion === "function") {
      await client.getServerVersion();
      return;
    }
    if (typeof client.getApiKeys === "function") {
      await client.getApiKeys();
      return;
    }
    if (typeof client.getMarkets === "function") {
      await client.getMarkets();
      return;
    }
    throw new Error("Unable to find compatible connectivity method on @polymarket/clob-client.");
  }

  /**
   * Displays legacy startup information (kept for backward compatibility).
   */
  private printProfessionalStartup(): void {
    // This method is now replaced by displayConfigurationSummary and displayMarketInfo
    // Kept for backward compatibility
  }

  /**
   * Initiates the main trading and optional redemption loops
   * with immediate first execution for responsive startup.
   */
  private startLoops(): void {
    this.pollTimer = setInterval(() => void this.safeTick(), this.cfg.pollIntervalMs);
    void this.safeTick();

    if (this.cfg.autoRedeemEnabled) {
      this.redeemTimer = setInterval(() => void this.safeRedeem(), ONE_MINUTE_MS);
      void this.safeRedeem();
    }
  }

  /**
   * Wrapper for the main tick function with error handling
   * to prevent unhandled promise rejections from stopping the bot.
   */
  private async safeTick(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.logger.error(`tick_failed: ${this.errMsg(error)}`);
    }
  }

  /**
   * Core trading logic: fetches prices, validates conditions,
   * and executes arbitrage trades when profitable opportunities arise.
   */
  private async tick(): Promise<void> {
    if (!this.running) return;
    this.resetDailyCounterIfNeeded();

    // Fetch current prices from both markets simultaneously
    const [m5, m15] = await Promise.all([
      this.withBackoff(() => this.fetchYesPrice(this.cfg.marketId5m), "fetch_market_5m"),
      this.withBackoff(() => this.fetchYesPrice(this.cfg.marketId15m), "fetch_market_15m"),
    ]);

    // Validate data freshness
    const now = Date.now();
    const stale5 = now - m5.updatedAtMs > this.cfg.staleDataMaxAgeMs;
    const stale15 = now - m15.updatedAtMs > this.cfg.staleDataMaxAgeMs;
    if (stale5 || stale15) {
      this.logger.warn(
        `stale_data_detected: 5mAge=${now - m5.updatedAtMs}ms, 15mAge=${now - m15.updatedAtMs}ms -> trade skipped`,
      );
      return;
    }

    // Calculate arbitrage opportunity
    const legCost = m5.ask + m15.ask;
    this.logger.info(
      `prices: ask5=${m5.ask.toFixed(4)} ask15=${m15.ask.toFixed(4)} combined=${legCost.toFixed(4)} threshold=${this.cfg.arbThreshold.toFixed(4)}`,
    );

    // Check if arbitrage is profitable
    if (legCost > this.cfg.arbThreshold) return;
    const expectedProfitPerShare = 1 - legCost;
    const tradeCost = legCost * this.cfg.defaultSize;

    // Risk management checks
    if (this.dailyTrades >= this.cfg.maxDailyTrades) {
      this.logger.warn("daily_trade_limit_reached -> trade skipped");
      return;
    }
    if (this.exposureUsd + tradeCost > this.cfg.maxExposureUsd) {
      this.logger.warn(
        `exposure_limit_hit: current=$${this.exposureUsd.toFixed(2)} next=$${tradeCost.toFixed(2)} max=$${this.cfg.maxExposureUsd.toFixed(2)}`,
      );
      return;
    }

    // Execute trades on both markets
    const order1 = await this.withBackoff(
      () => this.placeBuyYes(m5, this.cfg.defaultSize, this.cfg.marketId5m),
      "place_order_5m",
    );
    const order2 = await this.withBackoff(
      () => this.placeBuyYes(m15, this.cfg.defaultSize, this.cfg.marketId15m),
      "place_order_15m",
    );

    // Update position tracking
    this.dailyTrades += 1;
    this.exposureUsd += tradeCost;
    if (order1) this.activeOrders.add(order1);
    if (order2) this.activeOrders.add(order2);

    const tradesLeft = this.cfg.maxDailyTrades - this.dailyTrades;
    this.logger.success(
      `arb_executed: size=${this.cfg.defaultSize} cost=$${tradeCost.toFixed(2)} expectedProfit/share=$${expectedProfitPerShare.toFixed(4)} exposure=$${this.exposureUsd.toFixed(2)} tradesLeft=${tradesLeft}`,
    );
  }

  /**
   * Wrapper for position redemption with comprehensive error handling.
   */
  private async safeRedeem(): Promise<void> {
    try {
      await this.redeemSettledPositions();
    } catch (error) {
      this.logger.error(`auto_redeem_failed: ${this.errMsg(error)}`);
    }
  }

  /**
   * Automatically identifies and redeems payouts from settled prediction markets
   * to maintain optimal capital efficiency and reduce idle balances.
   */
  private async redeemSettledPositions(): Promise<void> {
    if (!this.cfg.autoRedeemEnabled) return;
    const client = this.clob as Record<string, (...args: unknown[]) => Promise<unknown>>;
    if (typeof client.getPositions !== "function" || typeof client.redeemPositions !== "function") {
      this.logger.warn("auto_redeem_skipped: client methods unavailable");
      return;
    }

    const result = await this.withBackoff(
      () => client.getPositions(this.wallet.address),
      "fetch_positions",
    );
    const positions = this.extractArray(result);
    const redeemable = positions.filter((p) => {
      const settled = Boolean((p as Record<string, unknown>).isSettled ?? (p as Record<string, unknown>).settled);
      const payout = Number((p as Record<string, unknown>).payout ?? 0);
      return settled && payout >= this.cfg.redeemThresholdUsd;
    });
    if (redeemable.length === 0) return;

    const ids = redeemable
      .map((p) => String((p as Record<string, unknown>).positionId ?? (p as Record<string, unknown>).id ?? ""))
      .filter(Boolean);
    if (ids.length === 0) return;

    await this.withBackoff(() => client.redeemPositions(ids), "redeem_positions");
    const total = redeemable.reduce<number>(
      (sum, p) => sum + Number((p as Record<string, unknown>).payout ?? 0),
      0,
    );
    this.logger.success(`redeemed_positions: count=${ids.length} payout=$${total.toFixed(2)}`);
  }

  /**
   * Fetches current YES token price from the specified market's order book.
   * Includes token ID resolution and multi-format price extraction.
   */
  private async fetchYesPrice(marketRef: string): Promise<PriceSnapshot> {
    const client = this.clob as Record<string, (...args: unknown[]) => Promise<unknown>>;

    // Resolve YES token first using market metadata
    let yesTokenId: string | undefined;
    if (typeof client.getMarket === "function") {
      const market = await client.getMarket(marketRef);
      yesTokenId = this.extractYesTokenId(market);
    }
    if (!yesTokenId && typeof client.getMarketByConditionId === "function") {
      const market = await client.getMarketByConditionId(marketRef);
      yesTokenId = this.extractYesTokenId(market);
    }
    if (!yesTokenId && typeof client.getMarketById === "function") {
      const market = await client.getMarketById(marketRef);
      yesTokenId = this.extractYesTokenId(market);
    }
    if (!yesTokenId) {
      // Fallback: use provided marketRef as token ID directly
      yesTokenId = marketRef;
    }

    let orderBook: unknown;
    if (typeof client.getOrderBook === "function") {
      orderBook = await client.getOrderBook(yesTokenId);
    } else if (typeof client.getBook === "function") {
      orderBook = await client.getBook(yesTokenId);
    } else {
      throw new Error("Orderbook method missing in @polymarket/clob-client.");
    }

    const ask = this.extractBestAsk(orderBook);
    const bid = this.extractBestBid(orderBook);
    const updatedAtMs = this.extractUpdatedAtMs(orderBook);

    if (!Number.isFinite(ask) || ask <= 0) throw new Error(`Invalid ask for market=${marketRef}`);
    return { ask, bid, updatedAtMs, marketRef, yesTokenId };
  }

  /**
   * Places a buy order for YES tokens on the specified market.
   * Supports multiple SDK versions with different order creation methods.
   */
  private async placeBuyYes(snapshot: PriceSnapshot, size: number, marketRef: string): Promise<string | null> {
    const client = this.clob as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const tokenId = snapshot.yesTokenId ?? marketRef;

    // Support different client method names across versions
    if (typeof client.createAndPostOrder === "function") {
      const res = await client.createAndPostOrder({
        tokenID: tokenId,
        side: "BUY",
        price: snapshot.ask,
        size,
      });
      return this.extractOrderId(res);
    }
    if (typeof client.postOrder === "function") {
      const res = await client.postOrder({
        tokenID: tokenId,
        side: "BUY",
        price: snapshot.ask,
        size,
      });
      return this.extractOrderId(res);
    }
    throw new Error("No compatible order posting method found on @polymarket/clob-client.");
  }

  /**
   * Extracts the YES token ID from market metadata.
   * Handles different market object structures across SDK versions.
   */
  private extractYesTokenId(market: unknown): string | undefined {
    if (!market || typeof market !== "object") return undefined;
    const m = market as Record<string, unknown>;

    // Search through outcomes array for "Yes" token
    const outcomes = this.extractArray(m.outcomes);
    for (const o of outcomes) {
      const outcome = String((o as Record<string, unknown>).outcome ?? (o as Record<string, unknown>).name ?? "").toLowerCase();
      if (outcome === "yes") {
        const token = (o as Record<string, unknown>).tokenId ?? (o as Record<string, unknown>).token_id;
        if (token) return String(token);
      }
    }

    // Direct token ID properties as fallback
    const yesToken = m.yesTokenId ?? m.yes_token_id;
    if (yesToken) return String(yesToken);
    return undefined;
  }

  /**
   * Extracts the best ask price from order book data.
   * Supports both array format ([price, size]) and object format ({price, size}).
   */
  private extractBestAsk(orderBook: unknown): number {
    if (!orderBook || typeof orderBook !== "object") return NaN;
    const ob = orderBook as Record<string, unknown>;
    const asks = this.extractArray(ob.asks);
    if (asks.length === 0) {
      const ask = ob.ask ?? ob.bestAsk;
      return Number(ask);
    }
    const first = asks[0] as Record<string, unknown>;
    return Number(first.price ?? first[0]);
  }

  /**
   * Extracts the best bid price from order book data.
   * Supports both array and object formats with safe defaults.
   */
  private extractBestBid(orderBook: unknown): number {
    if (!orderBook || typeof orderBook !== "object") return NaN;
    const ob = orderBook as Record<string, unknown>;
    const bids = this.extractArray(ob.bids);
    if (bids.length === 0) {
      const bid = ob.bid ?? ob.bestBid;
      return Number(bid ?? 0);
    }
    const first = bids[0] as Record<string, unknown>;
    return Number(first.price ?? first[0] ?? 0);
  }

  /**
   * Extracts the timestamp from order book data.
   * Falls back to current time if no valid timestamp found.
   */
  private extractUpdatedAtMs(orderBook: unknown): number {
    if (!orderBook || typeof orderBook !== "object") return Date.now();
    const ob = orderBook as Record<string, unknown>;
    const raw = ob.timestamp ?? ob.updatedAt ?? ob.updated_at ?? Date.now();
    const ts = typeof raw === "number" ? raw : Date.parse(String(raw));
    return Number.isFinite(ts) ? ts : Date.now();
  }

  /**
   * Extracts order ID from order creation response.
   * Handles different response property naming conventions.
   */
  private extractOrderId(orderResponse: unknown): string | null {
    if (!orderResponse || typeof orderResponse !== "object") return null;
    const r = orderResponse as Record<string, unknown>;
    const id = r.orderID ?? r.orderId ?? r.id ?? null;
    return id ? String(id) : null;
  }

  /**
   * Safely extracts array from unknown value with empty array fallback.
   */
  private extractArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  /**
   * Returns current UTC date string (YYYY-MM-DD) for daily trade counting.
   */
  private currentUtcDay(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Resets daily trade counter at UTC midnight to enforce daily limits.
   */
  private resetDailyCounterIfNeeded(): void {
    const day = this.currentUtcDay();
    if (day !== this.utcDay) {
      this.utcDay = day;
      this.dailyTrades = 0;
      this.logger.info("utc_midnight_reached: daily trade counter reset");
    }
  }

  /**
   * Implements exponential backoff retry logic for API operations.
   * Retries with increasing delays to handle transient failures gracefully.
   */
  private async withBackoff<T>(fn: () => Promise<T>, label: string, retries = 5): Promise<T> {
    let attempt = 0;
    let delayMs = 700;

    while (true) {
      try {
        return await fn();
      } catch (error) {
        attempt += 1;
        if (attempt > retries) {
          throw new Error(`${label} failed after ${retries} retries: ${this.errMsg(error)}`);
        }
        this.logger.warn(`${label} failed (attempt=${attempt}/${retries}) -> retry in ${delayMs}ms`);
        await this.sleep(delayMs);
        delayMs = Math.min(delayMs * 2, 10_000);
      }
    }
  }

  /**
   * Promise-based delay utility for async operations.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extracts error message from unknown error types safely.
   */
  private errMsg(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  /**
   * Registers signal handlers for graceful shutdown on SIGINT/SIGTERM.
   * Ensures proper cleanup of timers and resources.
   */
  private attachSignalHandlers(): void {
    const shutdown = async () => {
      console.log('');
      this.logger.warn("Shutdown signal received. Stopping bot gracefully...");
      await this.stop();
      console.log(chalk.gray(SEPARATOR));
      console.log(chalk.green.bold("  ✅  Bot stopped successfully"));
      console.log(chalk.gray(`  📊  Session summary: ${this.dailyTrades} trades executed, $${this.exposureUsd.toFixed(2)} exposure`));
      console.log(chalk.gray(SEPARATOR));
      process.exit(0);
    };

    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
  }

  /**
   * Stops all trading loops and cleans up timers.
   * Preserves state for potential restart scenarios.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.redeemTimer) clearInterval(this.redeemTimer);
    this.logger.info("Trading loops stopped, timers cleared");
  }
}

// ─── Environment Configuration ──────────────────────────────────────────────

/**
 * Retrieves environment variable with fallback to default value.
 * Handles empty/whitespace values as missing.
 */
function envValueOrDefault(key: string, defaultValue: string): string {
  const value = process.env[key];
  if (value === undefined || value === null || value.trim() === "") return defaultValue;
  return value.trim();
}

/**
 * Interactive environment configuration with validation.
 * Guides users through setting up all required parameters with
 * clear descriptions, defaults, and real-time validation feedback.
 */
async function confirmEnvInteractively(): Promise<Record<string, string>> {
  const finalValues: Record<string, string> = {};

  console.log(chalk.gray(SEPARATOR));
  console.log(chalk.bold("🔎 Interactive Environment Configuration"));
  console.log(chalk.gray("  Configure your bot parameters with guided validation"));
  console.log(chalk.gray(SEPARATOR));

  for (const item of ENV_DEFINITIONS) {
    const currentRaw = process.env[item.key]?.trim() ?? "";
    const hasCurrent = currentRaw.length > 0;
    const displayCurrent = item.secret ? maskSecret(currentRaw) : currentRaw || "(not configured)";

    console.log("");
    console.log(chalk.bold(`${categoryIcons[item.category]} ${chalk.white(item.key)}`));
    console.log(chalk.gray(`  └─ ${item.description}`));
    console.log(`  Current Value : ${chalk.cyan(displayCurrent)}`);
    console.log(`  Default       : ${chalk.gray(item.secret ? "(required - must be configured)" : item.defaultValue)}`);

    const { keep } = await inquirer.prompt<{ keep: boolean }>([
      {
        type: "confirm",
        name: "keep",
        message: "Keep current value?",
        default: hasCurrent,
      },
    ]);

    let candidate = hasCurrent ? currentRaw : "";
    if (!keep) {
      const { next } = await inquirer.prompt<{ next: string }>([
        {
          type: "input",
          name: "next",
          message: `Enter value for ${item.key} (type 'skip' to use default):`,
        },
      ]);
      if (["ignore", "i", "skip", "s"].includes(next.trim().toLowerCase())) {
        candidate = item.defaultValue;
      } else {
        candidate = next.trim();
      }
    } else if (!hasCurrent) {
      candidate = item.defaultValue;
    }

    const validation = item.validator(candidate);
    if (validation !== true) {
      console.log(chalk.red(`  ✗ Validation failed: ${validation}`));
      console.log(chalk.yellow("  Please correct the value and try again."));
      process.env[item.key] = "";
      const retry = await retrySingle(item);
      finalValues[item.key] = retry;
      process.env[item.key] = retry;
      continue;
    }

    finalValues[item.key] = candidate;
    process.env[item.key] = candidate;
    console.log(chalk.green("  ✓ Configuration accepted"));
  }

  printSummary(finalValues);
  return finalValues;
}

/**
 * Retries single environment variable input until valid value provided.
 */
async function retrySingle(item: EnvDefinition): Promise<string> {
  while (true) {
    const { next } = await inquirer.prompt<{ next: string }>([
      {
        type: "input",
        name: "next",
        message: `Set ${item.key} (type 'skip' for default):`,
      },
    ]);
    const candidate = ["ignore", "i", "skip", "s"].includes(next.trim().toLowerCase()) ? item.defaultValue : next.trim();
    const validation = item.validator(candidate);
    if (validation === true) return candidate;
    console.log(chalk.red(`  ✗ ${validation}`));
  }
}

/**
 * Displays formatted summary of all configured environment variables
 * organized by category for final review before bot starts.
 */
function printSummary(finalValues: Record<string, string>): void {
  const width = 84;
  const line = `┌${"─".repeat(width - 2)}┐`;
  const footer = `└${"─".repeat(width - 2)}┘`;
  const sep = `├${"─".repeat(width - 2)}┤`;

  const fit = (txt: string) => (txt.length > width - 4 ? `${txt.slice(0, width - 7)}...` : txt);
  const row = (txt: string) => `│ ${fit(txt).padEnd(width - 4)} │`;

  console.log("");
  console.log(chalk.blue(line));
  console.log(chalk.blue(row("Configuration Summary - All Parameters")));
  console.log(chalk.blue(sep));

  for (const category of categoryOrder) {
    console.log(chalk.magenta(row(`${categoryIcons[category]} ${category}`)));
    const vars = ENV_DEFINITIONS.filter((d) => d.category === category);
    for (const v of vars) {
      const raw = finalValues[v.key] ?? envValueOrDefault(v.key, v.defaultValue);
      const display = v.secret ? maskSecret(raw) : raw;
      console.log(row(`  ${v.key.padEnd(20)} = ${display}`));
    }
    if (category !== categoryOrder[categoryOrder.length - 1]) {
      console.log(chalk.blue(sep));
    }
  }

  console.log(chalk.blue(footer));
  console.log("");
}

/**
 * Converts environment variable record to typed BotConfig object.
 * Applies proper type conversions and validation.
 */
function toConfig(values: Record<string, string>): BotConfig {
  return {
    privateKey: values.PRIVATE_KEY,
    marketId5m: values.MARKET_ID_5M,
    marketId15m: values.MARKET_ID_15M,
    arbThreshold: Number(values.ARB_THRESHOLD),
    defaultSize: Number(values.DEFAULT_SIZE),
    maxDailyTrades: Number(values.MAX_DAILY_TRADES),
    maxExposureUsd: Number(values.MAX_EXPOSURE_USD),
    pollIntervalMs: Number(values.POLL_INTERVAL_MS),
    staleDataMaxAgeMs: Number(values.STALE_DATA_MAX_AGE_MS),
    autoRedeemEnabled: asBool(values.AUTO_REDEEM_ENABLED),
    redeemThresholdUsd: Number(values.REDEEM_THRESHOLD_USD),
    logLevel: values.LOG_LEVEL.toLowerCase() as LogLevel,
    polymarketApiUrl: values.POLYMARKET_API_URL,
    environment: values.ENVIRONMENT,
  };
}

// ─── Application Entry Point ────────────────────────────────────────────────

/**
 * Main application entry point.
 * Initializes environment, validates configuration,
 * and starts the arbitrage bot with error handling.
 */
async function main(): Promise<void> {
  try {
    // Display welcome banner before configuration
    console.log(chalk.cyan('╔══════════════════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('║') + '  ' + chalk.white.bold('POLYMARKET BTC ARBITRAGE BOT - Configuration Setup') + '                           ' + chalk.cyan('║'));
    console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════════╝'));
    console.log('');
    
    const values = await confirmEnvInteractively();
    const cfg = toConfig(values);
    const bot = new PolymarketArbBot(cfg);
    await bot.start();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n[${getTimestamp()}] [FATAL] ${msg}`));
    console.error(chalk.red('Bot failed to start. Please check your configuration and try again.'));
    process.exit(1);
  }
}

// Start the application
void main();