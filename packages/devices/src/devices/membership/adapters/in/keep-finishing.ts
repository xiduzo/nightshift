/**
 * Goes on with what stopped, now and every interval, until the signal
 * aborts. The wire hands it the bound function; this file imports
 * nothing of the slice.
 */
export function startKeepFinishing(
	keepFinishing: (signal: AbortSignal, everyMs?: number) => void,
	signal: AbortSignal,
	everyMs?: number,
): void {
	keepFinishing(signal, everyMs);
}
