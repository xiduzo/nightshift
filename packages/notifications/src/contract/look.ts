/**
 * The words of Needs a look: how a flow left its usual range. The rows of
 * the apps (through `@nightshift/client`) and the push of a flow that
 * turns severe say it the same way.
 */

/** One way a flow left its usual range, as its words need it. */
export type LookSignal = {
	kind: "failing" | "nothing" | "cost" | "length" | "slow";
	/** `failing`, `nothing`: how many runs in a row. */
	count?: number;
};

const runsInRow = (count: number | undefined) => `${count ?? 1} runs in a row`;

/** What is unusual, as a row says it. */
export function signalTitle(signal: LookSignal): string {
	switch (signal.kind) {
		case "failing":
			return (signal.count ?? 1) > 1
				? `Failed ${runsInRow(signal.count)}`
				: "Its last run failed";
		case "nothing":
			return `Nothing to do, ${runsInRow(signal.count)}`;
		case "cost":
			return "Its last run cost more than usual";
		case "length":
			return "Its last run took longer than usual";
		case "slow":
			return "Runs longer than usual";
	}
}
