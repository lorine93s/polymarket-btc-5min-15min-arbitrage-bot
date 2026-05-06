/** The Polymarket CLOB SDK logs raw HTTP failures with console.error; swap it out briefly for quiet startup. */
export async function runWithClobSdkErrorsSuppressed<T>(fn: () => Promise<T>): Promise<T> {
    const prev = console.error;
    console.error = (...args: unknown[]) => {
        const head = args[0];
        if (typeof head === "string" && head.includes("[CLOB Client]")) {
            return;
        }
        prev.apply(console, args);
    };
    try {
        return await fn();
    } finally {
        console.error = prev;
    }
}
