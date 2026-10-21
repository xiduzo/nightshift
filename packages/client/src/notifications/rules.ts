import type { OpenGate } from "../gates";
import type { RunStatus, RunSummary } from "../runs";

/**
 * What to tell the person about between two polls (or two items of a
 * stream): a Gate opened, a run finished, a run failed. The rules are
 * pure, so each app shows the notice its own way.
 */
export type Notice =
	| { kind: "gate-opened"; key: string; gate: OpenGate }
	| { kind: "run-finished"; run: RunSummary }
	| { kind: "run-failed"; run: RunSummary };

/** Which notices the person wants. A choice that is not set is off. */
export type NoticeChoices = {
	notifyGateOpened?: boolean | null;
	notifyRunFinished?: boolean | null;
	notifyRunFailed?: boolean | null;
};

/** One Gate, everywhere: its run and its step. */
export function gateKey(gate: Pick<OpenGate, "runId" | "stepId">): string {
	return `${gate.runId}:${gate.stepId}`;
}

/**
 * The open Gates now, and the ones that were not open in `before`. Without
 * `before` (the first load), what is open is the baseline: no notice.
 */
export function compareGates(
	before: ReadonlySet<string> | null,
	gates: readonly OpenGate[],
): { seen: Set<string>; notices: Notice[] } {
	const seen = new Set(gates.map(gateKey));
	if (!before) return { seen, notices: [] };
	const notices: Notice[] = [];
	for (const gate of gates) {
		const key = gateKey(gate);
		if (before.has(key)) continue;
		notices.push({ kind: "gate-opened", key, gate });
	}
	return { seen, notices };
}

/**
 * The status of each run now, and the runs that finished or failed since
 * `before`. Without `before` (the first load), nothing is new: no notice.
 * A run that is new and already ended counts.
 */
export function compareRuns(
	before: ReadonlyMap<string, RunStatus> | null,
	runs: readonly RunSummary[],
): { seen: Map<string, RunStatus>; notices: Notice[] } {
	const seen = new Map(runs.map((run) => [run.id, run.status]));
	if (!before) return { seen, notices: [] };
	const notices: Notice[] = [];
	for (const run of runs) {
		if (before.get(run.id) === run.status) continue;
		if (run.status === "finished") notices.push({ kind: "run-finished", run });
		if (run.status === "failed") notices.push({ kind: "run-failed", run });
	}
	return { seen, notices };
}

/** Whether the person wants this notice. */
export function isWanted(
	notice: Notice,
	choices: NoticeChoices | null | undefined,
): boolean {
	switch (notice.kind) {
		case "gate-opened":
			return choices?.notifyGateOpened === true;
		case "run-finished":
			return choices?.notifyRunFinished === true;
		case "run-failed":
			return choices?.notifyRunFailed === true;
	}
}

/**
 * The words of a notice, and its tag: a second notice with the same tag
 * replaces the first.
 */
export function describeNotice(notice: Notice): {
	title: string;
	body: string;
	tag: string;
} {
	switch (notice.kind) {
		case "gate-opened":
			return {
				title: `${notice.gate.projectName}: a Gate waits for you`,
				body: `${notice.gate.runTitle}\n${notice.gate.question}`,
				tag: `gate:${notice.key}`,
			};
		case "run-finished":
			return {
				title: "A run finished",
				body: notice.run.reason
					? `${notice.run.title}\nEnded on ${notice.run.reason}`
					: notice.run.title,
				tag: `run:${notice.run.id}:${notice.run.status}`,
			};
		case "run-failed":
			return {
				title: "A run failed",
				body: notice.run.reason
					? `${notice.run.title}\n${notice.run.reason}`
					: notice.run.title,
				tag: `run:${notice.run.id}:${notice.run.status}`,
			};
	}
}
