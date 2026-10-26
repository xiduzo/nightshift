import { runTime } from "@nightshift/client";
import type { StepSummary } from "@/shared/api";
import { formatDuration, useNow } from "@/shared/format";

/**
 * How long from `start` to `end`. Without an end it counts up each second
 * on this computer; the next update from Night Shift brings the real end.
 */
export function Elapsed({ start, end }: { start: number; end: number | null }) {
	const now = useNow(end === null ? 1000 : null);
	return <>{formatDuration((end ?? now) - start)}</>;
}

/**
 * How long these steps worked from `start`, how long they waited for you at
 * a Gate, and both together, in words. The work time stands still while a
 * Gate waits. Counts each second while a step runs or waits.
 */
export function useWorkTime(steps: StepSummary[], start: number) {
	const going = steps.some((step) => step.endedAt === null);
	const now = useNow(going ? 1000 : null);
	const time = runTime(steps, start, now);
	return {
		active: formatDuration(time.active),
		waited: time.waited >= 1000 ? formatDuration(time.waited) : null,
		open: formatDuration(time.open),
	};
}

/** How long these steps worked, without the time a Gate waited for you. */
export function WorkTime({
	steps,
	start,
}: {
	steps: StepSummary[];
	start: number;
}) {
	return <>{useWorkTime(steps, start).active}</>;
}
