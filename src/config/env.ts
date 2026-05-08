import "dotenv/config";

/**
 * Raw env accessors (may be undefined).
 *
 * Validation is intentionally NOT performed at import-time so we can print the
 * startup banner first and show a friendly "please add required value" warning.
 */
export const POLYMARKET_PRIVATE_KEY = process.env.POLYMARKET_PRIVATE_KEY;
export const POLYMARKET_FUNDER_ADDRESS =
  process.env.POLYMARKET_FUNDER_ADDRESS ?? process.env.PROXY_WALLET_ADDRESS;
export const POLYMARKET_SIGNATURE_TYPE = process.env.POLYMARKET_SIGNATURE_TYPE;