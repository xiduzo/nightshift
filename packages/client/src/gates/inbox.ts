import type { OpenGate } from "./types";

type Ordered = Pick<OpenGate, "openedAt" | "runId" | "stepId">;

/**
 * One Gate, everywhere: its run and its step. The Host keys a Gate's
 * notification the same way, so a screen can match the two.
 */
export function gateKey(gate: Pick<OpenGate, "runId" | "stepId">): string {
	return `${gate.runId}:${gate.stepId}`;
}

/**
 * The inbox order: the Gate that has waited longest first. Two Gates that
 * opened at the same moment keep one order on every screen.
 */
export function inboxOrder<G extends Ordered>(gates: readonly G[]): G[] {
	return [...gates].sort(
		(a, b) =>
			a.openedAt - b.openedAt ||
			a.runId.localeCompare(b.runId) ||
			a.stepId.localeCompare(b.stepId),
	);
}

/** How many Gates wait for this person: the ones their role lets them answer. */
export function waitingForYou(
	gates: readonly Pick<OpenGate, "canAnswer">[],
): number {
	return gates.filter((gate) => gate.canAnswer).length;
}

/** How long a Gate has waited: "under a minute", "12 min", "3 h 5 min", "2 days". */
export function waitedText(ms: number): string {
	const minutes = Math.floor(Math.max(0, ms) / 60_000);
	if (minutes < 1) return "under a minute";
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
	}
	const days = Math.floor(hours / 24);
	return days === 1 ? "1 day" : `${days} days`;
}

/**
 * The run a Gate waits in: its flow ("Quick run" for a run without a flow
 * file), and what sets this run apart from other runs of that flow (its
 * inputs, or the prompt of a quick run). Null when nothing does.
 */
export function gateRun(gate: Pick<OpenGate, "flowName" | "runTitle">): {
	flow: string;
	detail: string | null;
} {
	const { flowName, runTitle } = gate;
	if (!flowName) return { flow: "Quick run", detail: runTitle || null };
	// A flow run's title is the flow name, then its text inputs.
	const prefix = `${flowName} · `;
	const detail =
		runTitle === flowName
			? ""
			: runTitle.startsWith(prefix)
				? runTitle.slice(prefix.length)
				: runTitle;
	return { flow: flowName, detail: detail || null };
}

/** Whether a notification changes the inbox: a Gate opened or closed. */
export function changesInbox(item: { kind: string }): boolean {
	return item.kind === "gate-opened" || item.kind === "gate-closed";
}

/**
 * Whether Night Shift refused an answer because the Gate is closed: someone
 * answered it first, or its run ended. `gates.resolve` refuses that with
 * BAD_REQUEST.
 */
export function isGateClosed(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "BAD_REQUEST"
	);
}
