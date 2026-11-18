/** How much a flow was used lately: for the order of the flows to start. */
export type FlowUse = {
	/** Runs started by a person, not a schedule or webhook. */
	manual: number;
	runs: number;
};

/** The window the use counts in. */
export const FLOW_USE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The flow names, the most used first: runs a person started in the
 * window, then all runs in the window, then by name. Runs before the
 * window, or without a flow, do not count.
 */
export function rankFlowsByUse(
	names: readonly string[],
	runs: readonly {
		flowName: string | null;
		createdAt: number;
		trigger: { kind: string };
	}[],
	now: number,
	windowMs = FLOW_USE_WINDOW_MS,
): { name: string; use: FlowUse }[] {
	const uses = new Map<string, FlowUse>();
	for (const run of runs) {
		if (run.flowName === null || run.createdAt < now - windowMs) continue;
		const use = uses.get(run.flowName) ?? { manual: 0, runs: 0 };
		use.runs += 1;
		if (run.trigger.kind === "manual") use.manual += 1;
		uses.set(run.flowName, use);
	}
	return names
		.map((name) => ({ name, use: uses.get(name) ?? { manual: 0, runs: 0 } }))
		.sort(
			(a, b) =>
				b.use.manual - a.use.manual ||
				b.use.runs - a.use.runs ||
				a.name.localeCompare(b.name),
		);
}
