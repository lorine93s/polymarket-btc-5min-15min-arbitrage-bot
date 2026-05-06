import { Wallet } from "ethers";
import { Chain, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import {
  POLYMARKET_FUNDER_ADDRESS,
  POLYMARKET_PRIVATE_KEY,
  POLYMARKET_SIGNATURE_TYPE,
} from "../config";

export const HOST = "https://clob.polymarket.com";
export const CHAIN_ID = Chain.POLYGON;

// Wrap ethers v6 Wallet so @polymarket/clob-client-v2 can use it.
export const SIGNER = Object.assign(new Wallet(POLYMARKET_PRIVATE_KEY), {
  // clob-client-v2 expects _signTypedData (ethers v5-style); delegate to v6 signTypedData.
  _signTypedData(domain: any, types: any, value: any) {
    return (this as any).signTypedData(domain, types, value);
  },
});

// For funded wallets (proxy/deposit), SIGNER is the EOA that signs and
// FUNDER is the address that actually holds the funds.
export const FUNDER = POLYMARKET_FUNDER_ADDRESS;

const SIGNATURE_TYPE_BY_NAME = {
  EOA: SignatureTypeV2.EOA,
  POLY_PROXY: SignatureTypeV2.POLY_PROXY,
  POLY_GNOSIS_SAFE: SignatureTypeV2.POLY_GNOSIS_SAFE,
  POLY_1271: SignatureTypeV2.POLY_1271,
} as const;

export const SIGNATURE_TYPE = (() => {
  const rawType = POLYMARKET_SIGNATURE_TYPE?.trim();
  if (!rawType) {
    // Most funded-wallet integrations use proxy signatures.
    return SignatureTypeV2.POLY_PROXY;
  }
  const resolvedType = SIGNATURE_TYPE_BY_NAME[rawType as keyof typeof SIGNATURE_TYPE_BY_NAME];
  if (resolvedType === undefined) {
    throw new Error(
      `Invalid POLYMARKET_SIGNATURE_TYPE: ${rawType}. Valid values: ${Object.keys(SIGNATURE_TYPE_BY_NAME).join(", ")}`
    );
  }
  return resolvedType;
})();

const PRICE_FETCH_TIMEOUT_MS = 8000;
const PRICE_FETCH_RETRIES = 2;
const PRICE_FETCH_RETRY_DELAY_MS = 500;
const LAST_PRICE_CACHE = new Map<string, any>();

function getPriceCacheKey(upTokenId: string, downTokenId: string): string {
  return `${upTokenId}:${downTokenId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestPrices(upTokenId: string, downTokenId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRICE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch("https://clob.polymarket.com/prices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          token_id: upTokenId,
          side: "BUY",
        },
        {
          token_id: upTokenId,
          side: "SELL",
        },
        {
          token_id: downTokenId,
          side: "BUY",
        },
        {
          token_id: downTokenId,
          side: "SELL",
        },
      ]),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Price API request failed with status ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export const getPrices = async (upTokenId: string, downTokenId: string) => {
  const cacheKey = getPriceCacheKey(upTokenId, downTokenId);
  let lastError: unknown;

  for (let attempt = 0; attempt <= PRICE_FETCH_RETRIES; attempt++) {
    try {
      const prices = await requestPrices(upTokenId, downTokenId);
      LAST_PRICE_CACHE.set(cacheKey, prices);
      return prices;
    } catch (error) {
      lastError = error;
      if (attempt < PRICE_FETCH_RETRIES) {
        await sleep(PRICE_FETCH_RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  const cachedPrices = LAST_PRICE_CACHE.get(cacheKey);
  if (cachedPrices) {
    return cachedPrices;
  }

  throw new Error(`Unable to fetch prices after retries: ${String(lastError)}`);
};