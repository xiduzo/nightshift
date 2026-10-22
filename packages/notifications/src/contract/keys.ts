/**
 * The key of a notification: the id of one notification on every screen.
 * A second notification of a key replaces the first, and an answer to a
 * Gate takes its notification back everywhere. Run and step ids hold no
 * colon (they are UUIDs), so the parts of a key never mix.
 */

/** One Gate, everywhere: its run and its step (`runId:stepId`). */
export function gateKey(gate: { runId: string; stepId: string }): string {
	return `${gate.runId}:${gate.stepId}`;
}

/** One ending of a run (`runId:end:<seq>`): a run can end again after a resume. */
export function runEndKey(runId: string, seq: number): string {
	return `${runId}:end:${seq}`;
}

/** The notification at the end of quiet hours (`waiting:<ms>`). */
export function waitingKey(at: number): string {
	return `waiting:${at}`;
}

/** What a key names. */
export type NotificationKey =
	| { kind: "gate"; runId: string; stepId: string }
	| { kind: "run-end"; runId: string; seq: number }
	| { kind: "waiting"; at: number };

const WAITING = "waiting";

function integer(part: string): number | null {
	return /^\d+$/.test(part) ? Number(part) : null;
}

/** What a key names. Null: not a key Night Shift makes. */
export function parseKey(key: string): NotificationKey | null {
	const parts = key.split(":");
	if (parts.some((part) => part === "")) return null;
	const [first, second, third] = parts;
	if (first === undefined || second === undefined) return null;
	if (parts.length === 2) {
		if (first !== WAITING)
			return { kind: "gate", runId: first, stepId: second };
		const at = integer(second);
		return at === null ? null : { kind: "waiting", at };
	}
	if (parts.length === 3 && first !== WAITING && second === "end") {
		const seq = third === undefined ? null : integer(third);
		return seq === null ? null : { kind: "run-end", runId: first, seq };
	}
	return null;
}

/** The run and step of a Gate's key. Null for any other key. */
export function parseGateKey(
	key: string,
): { runId: string; stepId: string } | null {
	const parsed = parseKey(key);
	return parsed?.kind === "gate"
		? { runId: parsed.runId, stepId: parsed.stepId }
		: null;
}

/** Whether a key names a Gate. A run's end and the end of quiet hours do not. */
export function isGateKey(key: string): boolean {
	return parseGateKey(key) !== null;
}
