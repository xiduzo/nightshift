import type { OpenGate } from "./types";

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
