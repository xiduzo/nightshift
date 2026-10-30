/**
 * What a push carries: the categories and channels the phone defines, the
 * buttons of a lock-screen Gate, and the `data` every screen reads. The
 * Host builds pushes from these values (`channels/expo.ts`,
 * `channels/web-push.ts`). The phone and the browser read them through
 * `@nightshift/client`.
 */

/** The notification categories of a push. */
export const PUSH_CATEGORY = {
	/** A lock-screen Gate with two options: Approve and Reject on the notification. */
	decide: "gate-decide",
	/** Any other Gate, the end of quiet hours, and the digest: a tap opens the inbox. */
	open: "gate-open",
	/** A run that finished or failed, or a step that waits for a Device: a tap opens the run. */
	run: "run",
} as const;

/**
 * The Android notification channels of a push: Gates at high importance
 * (they show at the top and make a sound), runs at default. A person can
 * mute one channel in Android's settings and keep the other.
 */
export const PUSH_ANDROID_CHANNEL = { gates: "gates", runs: "runs" } as const;

/** The two buttons of `gate-decide`. Approve answers the first option, Reject the second. */
export const PUSH_ACTION = { approve: "approve", reject: "reject" } as const;

/** What a push the person sees is about. */
export const PUSH_MESSAGE_KINDS = [
	"gate-opened",
	"run-finished",
	"run-failed",
	"device-wait",
	"gates-waiting",
	"digest",
] as const;
export type PushMessageKind = (typeof PUSH_MESSAGE_KINDS)[number];

/** One option of a Gate, as a notification button shows it. */
export type GateOption = {
	/** What the answer sends: the choice's name. */
	id: string;
	/** What the button says: the author's text. */
	label: string;
};

/** The `data` of a push the person sees. */
export type PushData = {
	kind: PushMessageKind;
	/** The notification key (`keys.ts`). */
	key: string;
	/** Null for `gates-waiting`, which spans Spaces. */
	spaceId: string | null;
	runId: string | null;
	/** The Gate's step, or the step that waits for a Device. Null for a run. */
	stepId: string | null;
	/** `gates-waiting` only: how many Gates wait. */
	count?: number | null;
	/** `gate-decide` only: the two options in the author's order. */
	options?: GateOption[];
};

const KINDS = new Set<string>(PUSH_MESSAGE_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

/** The data of a push as the Host sent it, or null when it is not one of the Host's. */
export function pushDataOf(raw: unknown): PushData | null {
	if (!isRecord(raw)) return null;
	const kind = text(raw.kind);
	const key = text(raw.key);
	if (!kind || !KINDS.has(kind) || !key) return null;
	const data: PushData = {
		kind: kind as PushMessageKind,
		key,
		spaceId: text(raw.spaceId),
		runId: text(raw.runId),
		stepId: text(raw.stepId),
	};
	if (kind === "gates-waiting" && typeof raw.count === "number") {
		data.count = raw.count;
	}
	if (Array.isArray(raw.options)) {
		const options = raw.options.flatMap((option) => {
			if (!isRecord(option)) return [];
			const id = text(option.id);
			return id ? [{ id, label: text(option.label) ?? id }] : [];
		});
		if (options.length === 2) data.options = options;
	}
	return data;
}

/** The data of a withdraw push: it takes the notification of the key back. */
export function withdrawData(key: string): { withdraw: string } {
	return { withdraw: key };
}

/** The key of a withdraw push, or null for any other push. */
export function withdrawKeyOf(raw: unknown): string | null {
	return isRecord(raw) ? text(raw.withdraw) : null;
}
