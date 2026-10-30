/** How times, durations, costs and counts read, and useNow (from `@nightshift/client`) that keeps them current. */

export { useNow } from "@nightshift/client";
export type { KnownCost } from "./format";
export {
	costNote,
	dayWord,
	formatCost,
	formatCountdown,
	formatDateTime,
	formatDayTime,
	formatDuration,
	formatKnownCost,
	formatRelative,
	formatSize,
	formatStepCost,
	formatTime,
	formatTokens,
	nextOccurrence,
	noCostYet,
	sumKnownCost,
	truncate,
} from "./format";
