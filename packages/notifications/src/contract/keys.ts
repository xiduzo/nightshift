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

/**
 * One step's wait for an offline Device (`runId:wait:<stepId>`). The
 * step looks again every minute and sleeps again: those sleeps keep the
 * one notification.
 */
export function deviceWaitKey(wait: { runId: string; stepId: string }): string {
	return `${wait.runId}:wait:${wait.stepId}`;
}

/**
 * The morning digest of one day (`digest:<YYYY-MM-DD>`, the day in the
 * Person's time zone). The delivery log keys it per Person, so each
 * Person gets one digest a day, also after a restart.
 */
export function digestKey(day: string): string {
	return `${DIGEST}:${day}`;
}

/** The notification at the end of quiet hours (`waiting:<ms>`). */
export function waitingKey(at: number): string {
	return `waiting:${at}`;
}

/** What a key names. */
export type NotificationKey =
	| { kind: "gate"; runId: string; stepId: string }
	| { kind: "run-end"; runId: string; seq: number }
	| { kind: "device-wait"; runId: string; stepId: string }
	| { kind: "waiting"; at: number }
	| { kind: "digest"; day: string };

const WAITING = "waiting";
const DIGEST = "digest";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
		if (first === DIGEST) {
			return DAY.test(second) ? { kind: "digest", day: second } : null;
		}
		if (first !== WAITING)
			return { kind: "gate", runId: first, stepId: second };
		const at = integer(second);
		return at === null ? null : { kind: "waiting", at };
	}
	if (parts.length === 3 && first !== WAITING && second === "end") {
		const seq = third === undefined ? null : integer(third);
		return seq === null ? null : { kind: "run-end", runId: first, seq };
	}
	if (parts.length === 3 && first !== WAITING && second === "wait" && third) {
		return { kind: "device-wait", runId: first, stepId: third };
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

/** The run and step of a device wait's key. Null for any other key. */
export function parseDeviceWaitKey(
	key: string,
): { runId: string; stepId: string } | null {
	const parsed = parseKey(key);
	return parsed?.kind === "device-wait"
		? { runId: parsed.runId, stepId: parsed.stepId }
		: null;
}

/** Whether a key names a Gate. A run's end, a device wait, the end of quiet hours and a digest do not. */
export function isGateKey(key: string): boolean {
	return parseGateKey(key) !== null;
}
