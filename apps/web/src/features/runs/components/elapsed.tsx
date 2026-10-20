import { formatDuration, useNow } from "@/shared/format";

/**
 * How long from `start` to `end`. Without an end it counts up each second
 * on this computer; the next update from Night Shift brings the real end.
 */
export function Elapsed({ start, end }: { start: number; end: number | null }) {
	const now = useNow(end === null ? 1000 : null);
	return <>{formatDuration((end ?? now) - start)}</>;
}
