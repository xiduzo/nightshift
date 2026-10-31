import {
	agoLabel,
	compactCount,
	costLabel,
	flowLabel,
	hasEnded,
	type ItemSummary,
	type RunDetail,
	type RunStatus,
	type StepSummary,
	tokensSplit,
	waitedText,
	whenLabel,
} from "@nightshift/client";

/**
 * The run screen without React Native: its Details tiles and what the run
 * made. Which actions it offers is the engine's rule (`runActions`).
 */

/** One Details tile: "Branch / nightshift/run-42" (mono). */
export type RunFact = {
	label: string;
	value: string;
	sub?: string;
	mono?: boolean;
	/** A row of its own: the run id. */
	wide?: boolean;
};

type Computer = Pick<RunDetail["device"], "name" | "thisDevice">;

/** The computer a run runs on, by its name. The Host when it has no name. */
function computerName(device: Computer): string {
	if (device.name) return device.name;
	return device.thisDevice ? "Your Host" : "Another computer";
}

/** Who started the run: "By Sander", "By a schedule". */
function startedBy(
	run: Pick<RunDetail, "trigger" | "startedBy">,
): string | undefined {
	if (run.trigger.kind === "schedule") return "By a schedule";
	if (run.trigger.kind === "webhook") return "By a webhook";
	return run.startedBy?.name ? `By ${run.startedBy.name}` : undefined;
}

/** The cost tile: its value, and why it may be lower than the real cost. */
function costFact(
	run: Pick<
		RunDetail,
		"costUsd" | "costMissing" | "costCalls" | "costEstimated"
	>,
	ended: boolean,
): RunFact {
	const known = costLabel(run);
	if (known === null) {
		return run.costMissing > 0
			? { label: "Cost", value: "Not known", sub: "No step reported its cost" }
			: { label: "Cost", value: ended ? "None" : "None yet" };
	}
	return {
		label: "Cost",
		value: known,
		sub:
			run.costMissing > 0
				? "A step did not report its cost"
				: run.costEstimated
					? "Part of it is estimated"
					: undefined,
	};
}

/** The tokens tile: how many the run's agents used, in and out. None when none are known. */
function tokensFact(run: Pick<RunDetail, "metrics">): RunFact[] {
	const tokens = run.metrics?.tokens;
	const split = tokensSplit(tokens);
	if (!tokens || split === null) return [];
	return [
		{
			label: "Tokens",
			value: compactCount(tokens.input + tokens.output),
			sub: split,
		},
	];
}

/**
 * The Details of a run, two by two: flow, branch, computer, when it
 * started and by whom, how long it took and how many steps, its cost,
 * the tokens its agents used, and its id. `steps` are the run's own steps, live, or null while they load;
 * `now` counts a run on its way.
 */
export function runFacts(
	run: Pick<
		RunDetail,
		| "id"
		| "flowName"
		| "branch"
		| "device"
		| "createdAt"
		| "endedAt"
		| "trigger"
		| "startedBy"
		| "costUsd"
		| "costMissing"
		| "costCalls"
		| "costEstimated"
		| "metrics"
	>,
	{
		status,
		steps,
		now,
	}: { status: RunStatus; steps: number | null; now: number },
): RunFact[] {
	const end = hasEnded(status) ? (run.endedAt ?? now) : now;
	return [
		{ label: "Flow", value: flowLabel(run) },
		...(run.branch ? [{ label: "Branch", value: run.branch, mono: true }] : []),
		{ label: "Computer", value: computerName(run.device) },
		{
			label: "Started",
			value: whenLabel(run.createdAt, now),
			sub: startedBy(run) ?? agoLabel(run.createdAt, now),
		},
		{
			label: "Duration",
			value: waitedText(end - run.createdAt),
			...(steps === null
				? {}
				: { sub: steps === 1 ? "1 step" : `${steps} steps` }),
		},
		costFact(run, hasEnded(status)),
		...tokensFact(run),
		{ label: "Run", value: run.id, mono: true, wide: true },
	];
}

/** A link a step's item points to: a pull request, a ticket. */
export type RunLink = Pick<ItemSummary, "id" | "title" | "state" | "branch"> & {
	url: string;
};

/** The links of the run's items, once each, in the order the run made them. */
export function runLinks(
	steps: readonly Pick<StepSummary, "items">[],
): RunLink[] {
	const links = new Map<string, RunLink>();
	for (const step of steps) {
		for (const item of step.items) {
			if (item.url === null) continue;
			links.set(item.url, {
				id: item.id,
				title: item.title,
				state: item.state,
				branch: item.branch,
				url: item.url,
			});
		}
	}
	return [...links.values()];
}

const ITEM_STATE: Record<ItemSummary["state"], string> = {
	done: "Done",
	running: "Running",
	failed: "Failed",
	blocked: "Blocked",
	halted: "Stopped",
};

/** An item's state in words: "Done", "Blocked". */
export function itemStateLabel(state: ItemSummary["state"]): string {
	return ITEM_STATE[state];
}

/** "12 KB", "1.4 MB": the size of a file the run made. */
export function sizeLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
