import { retryDelay, type Wait, waitFor } from "@nightshift/client";

/**
 * Tries `attempt` until it works, with a growing wait between tries: the
 * Host may be offline at the moment the app starts. Null when the signal
 * stops it or after `tries` tries. Pure apart from the wait, which a test
 * replaces.
 */
export async function withRetry<T>(
	attempt: () => Promise<T>,
	options: {
		signal: AbortSignal;
		tries?: number;
		wait?: Wait;
		delay?: (attempt: number) => number;
		onError?: (error: unknown, attempt: number) => void;
	},
): Promise<T | null> {
	const tries = options.tries ?? 6;
	const wait = options.wait ?? waitFor;
	const delay = options.delay ?? retryDelay;
	for (let n = 0; n < tries; n += 1) {
		if (options.signal.aborted) return null;
		try {
			return await attempt();
		} catch (error) {
			options.onError?.(error, n);
			if (n === tries - 1) break;
			await wait(delay(n), options.signal);
		}
	}
	return null;
}

/**
 * The SecureStore key of this phone's push target at one Host. A key holds
 * only letters, digits, ".", "-" and "_".
 */
export function targetKeyOf(address: string): string {
	return `nightshift.push-target.${address.replace(/[^A-Za-z0-9]/g, "_")}`;
}
