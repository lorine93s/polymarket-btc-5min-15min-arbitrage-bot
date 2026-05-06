import "dotenv/config";

export const POLYMARKET_PRIVATE_KEY = reteriveDotEnv("POLYMARKET_PRIVATE_KEY");
export const POLYMARKET_FUNDER_ADDRESS = reteriveDotEnv(
    "POLYMARKET_FUNDER_ADDRESS",
    "PROXY_WALLET_ADDRESS"
);
export const POLYMARKET_SIGNATURE_TYPE = process.env.POLYMARKET_SIGNATURE_TYPE;

function reteriveDotEnv(...keys: string[]): string {
    const env = keys.map(key => process.env[key]).find(Boolean);
    if (!env) {
        throw new Error(`${keys.join(" or ")} is not set`);
    }
    return env;
}