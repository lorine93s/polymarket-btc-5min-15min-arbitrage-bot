/**
 * Plain-language error summary for trading workflow logs (no stack traces).
 */
export function describeTradingError(error: unknown): { kind: string; why: string } {
    const err = error as Record<string, unknown> | undefined;
    const message = typeof err?.message === "string" ? err.message : String(error ?? "unknown error");
    const code = typeof err?.code === "string" ? err.code : undefined;
    const response = err?.response as { status?: number; data?: { error?: string } } | undefined;
    const status =
        typeof err?.status === "number"
            ? err.status
            : typeof response?.status === "number"
              ? response.status
              : undefined;

    const fromFlat = (err?.data as { error?: string } | undefined)?.error;
    const fromResponse = response?.data?.error;
    const dataErrStr =
        typeof fromFlat === "string" ? fromFlat : typeof fromResponse === "string" ? fromResponse : "";

    if (status === 401 || /unauthorized/i.test(message) || /unauthorized/i.test(dataErrStr)) {
        return {
            kind: "Authentication",
            why: "The CLOB rejected the request (unauthorized). Check wallet, signature type, funder, and API key derivation.",
        };
    }

    if (status === 400 && /derive api key/i.test(dataErrStr)) {
        return {
            kind: "CLOB API key",
            why: "No API key exists yet for this wallet and signature mode. The client will create one next (normal on first run).",
        };
    }

    if (
        code === "ERR_INVALID_ARG_TYPE" &&
        (/buffer/i.test(message) || /first argument must be of type string/i.test(message))
    ) {
        return {
            kind: "L2 signing",
            why: "Order signing failed: a required credential value was undefined (often missing API secret or incomplete creds on the CLOB client).",
        };
    }

    if (code === "ERR_INVALID_ARG_TYPE") {
        return {
            kind: "Invalid argument",
            why: message,
        };
    }

    if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|network/i.test(message) || code === "ECONNRESET") {
        return {
            kind: "Network",
            why: "Connection issue reaching Polymarket. Will retry when the request runs again.",
        };
    }

    if (typeof status === "number" && status >= 500) {
        return {
            kind: "Server error",
            why: `Polymarket returned HTTP ${status}. Often transient; retries may succeed.`,
        };
    }

    if (typeof status === "number" && status >= 400) {
        return {
            kind: "Request rejected",
            why: `HTTP ${status}${dataErrStr ? `: ${dataErrStr}` : ""}.`,
        };
    }

    return {
        kind: "Error",
        why: message.length > 200 ? `${message.slice(0, 197)}…` : message,
    };
}

/** True only for errors where an immediate re-post may help (network, 5xx, rate limit). */
export function shouldBurstRetryTradingError(error: unknown): boolean {
    const err = error as Record<string, unknown> | undefined;
    const message = typeof err?.message === "string" ? err.message : "";
    const code = typeof err?.code === "string" ? err.code : undefined;
    const status =
        typeof err?.status === "number"
            ? err.status
            : typeof (err?.response as { status?: number } | undefined)?.status === "number"
              ? (err!.response as { status: number }).status
              : undefined;

    if (err?.status === 401) return false;
    if (code === "ERR_INVALID_ARG_TYPE") return false;

    if (typeof status === "number") {
        if (status === 429) return true;
        if (status >= 500) return true;
        if (status >= 400) return false;
    }

    const transientCodes = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"];
    if (code && transientCodes.includes(code)) return true;
    if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(message)) return true;

    return false;
}
