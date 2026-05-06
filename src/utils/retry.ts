import { describeTradingError, shouldBurstRetryTradingError } from "./tradingErrorMessage";

/**
 * Retry utility function for instant retries on failure
 * @param fn - The async function to retry
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param operationName - Name of the operation for logging
 * @returns Promise that resolves with the function result or rejects after all retries fail
 */
export async function retryWithInstantRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    operationName: string = "Operation"
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn();
            if (attempt > 0) {
                console.log(`✅ ${operationName} succeeded on retry attempt ${attempt}`);
            }
            return result;
        } catch (error: unknown) {
            lastError = error;

            const err = error as { status?: number; data?: { error?: string }; message?: string };

            // Don't retry on authentication errors
            if (err?.status === 401 || (typeof err?.data?.error === "string" && err.data.error.includes("Unauthorized"))) {
                throw error;
            }

            // Don't retry on validation errors (these are not transient)
            const msg = typeof err?.message === "string" ? err.message : "";
            if (msg.includes("Cannot") || msg.includes("invalid") || msg.includes("missing")) {
                throw error;
            }

            if (!shouldBurstRetryTradingError(error)) {
                throw error;
            }

            const { kind, why } = describeTradingError(error);

            if (attempt < maxRetries) {
                console.log(
                    `🔔 ${operationName} | ${kind}: ${why} — instant retry ${attempt + 1}/${maxRetries + 1}`
                );
            } else {
                console.log(
                    `⚠️ ${operationName} | ${kind}: ${why} — giving up after ${maxRetries + 1} tries`
                );
            }
        }
    }

    throw lastError;
}
