import type { RunEnding, RunEndReason } from "../events";

/**
 * The code of a `RunEnded` that was logged without one, read from its
 * sentence. Only the fold reads it (`fold-run.ts`), for such a log: every
 * writer gives the code beside the sentence, so no writer calls this. It
 * knows the sentences the engine wrote when it logged no code.
 */
export function unrecordedEndReason(end: {
	status: RunEnding;
	reason: string | null;
	result: "done" | "nothing-to-do" | "failed" | null;
}): RunEndReason {
	// A run that finished took a chosen end, whatever its message says.
	if (end.status === "finished" && end.result !== "failed") return "finished";
	const reason = end.reason ?? "";
	if (reason.includes("Usage limit:")) return "agent.usage_limit";
	if (
		reason.includes("The network is down:") ||
		reason.includes("The network was down")
	) {
		return "agent.network";
	}
	if (reason === "Reached the stop time") return "stop_time";
	if (reason.includes("The run spent $") && reason.includes("budget")) {
		return "guard.budget";
	}
	if (
		reason.includes("reached its limit of") &&
		reason.includes("turns, so the step stopped")
	) {
		return "guard.turns";
	}
	if (reason.includes("times in a row with the same input")) {
		return "guard.looping";
	}
	if (reason.includes("showed no activity")) return "guard.idle";
	if (reason.includes("reached the limit of") && reason.includes("steps")) {
		return "guard.max_steps";
	}
	if (
		end.status === "stopped" &&
		(reason === "" || reason === "Stopped after the running step, as asked.")
	) {
		return "stopped_by_person";
	}
	return "_OTHER";
}
