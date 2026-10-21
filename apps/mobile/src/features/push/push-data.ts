/**
 * What a push from the Host carries, and what the phone does with it. Pure:
 * the native parts (`notifications.ts`, `background.ts`) ask the phone, this
 * decides. The shapes follow the "Phone push contract" in
 * `docs/research/mobile.md` and `packages/notifications/src/channels/expo.ts`.
 */

/** The notification categories the Host names (`EXPO_CATEGORY` on the Host). */
export const CATEGORY = {
	/** A lock-screen Gate with two options: Approve and Reject on the notification. */
	decide: "gate-decide",
	/** Any other Gate, and the end of quiet hours: a tap opens the app. */
	open: "gate-open",
	/** A run that finished or failed: a tap opens the run. */
	run: "run",
} as const;

/** The Android channels the Host names (`EXPO_ANDROID_CHANNEL` on the Host). */
export const ANDROID_CHANNEL = { gates: "gates", runs: "runs" } as const;

/** The two buttons of `gate-decide`. Approve answers the first option, Reject the second. */
export const ACTION = { approve: "approve", reject: "reject" } as const;

export type PushKind =
	| "gate-opened"
	| "run-finished"
	| "run-failed"
	| "gates-waiting";

/** The `data` of a push the person sees. */
export type PushData = {
	kind: PushKind;
	/** `runId:stepId` for a Gate, `runId:end:<seq>` for a run's end, `waiting:<ms>`. */
	key: string;
	spaceId: string | null;
	runId: string | null;
	stepId: string | null;
	/** `gate-decide` only: the two options in the author's order. */
	options?: { id: string; label: string }[];
};

const KINDS = new Set<string>([
	"gate-opened",
	"run-finished",
	"run-failed",
	"gates-waiting",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

/** The `data` of a shown notification as the Host sent it, or null when it is not one of the Host's. */
export function pushDataOf(raw: unknown): PushData | null {
	if (!isRecord(raw)) return null;
	const kind = text(raw.kind);
	const key = text(raw.key);
	if (!kind || !KINDS.has(kind) || !key) return null;
	const data: PushData = {
		kind: kind as PushKind,
		key,
		spaceId: text(raw.spaceId),
		runId: text(raw.runId),
		stepId: text(raw.stepId),
	};
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

/**
 * The `data` of a push that reached the background task. iOS gives the
 * Expo body as a JSON string (`dataString`) and as `body`; Android gives
 * `dataString`. A test push may give the fields as they are.
 */
export function taskDataOf(payload: unknown): Record<string, unknown> | null {
	if (!isRecord(payload)) return null;
	const data = isRecord(payload.data) ? payload.data : payload;
	if (typeof data.dataString === "string") {
		try {
			const parsed: unknown = JSON.parse(data.dataString);
			if (isRecord(parsed)) return parsed;
		} catch {
			// Not JSON: read the other fields.
		}
	}
	if (isRecord(data.body)) return data.body;
	return data;
}

/** The key of a withdraw push (`{ withdraw: key }`), or null for any other push. */
export function withdrawKeyOf(data: unknown): string | null {
	return isRecord(data) ? text(data.withdraw) : null;
}

/** The answer a lock-screen button sends: bound to one run and one step. */
export type ActionAnswer = { runId: string; stepId: string; choice: string };

/**
 * The answer of a button on a `gate-decide` notification: Approve answers
 * the first option, Reject the second. Null for a tap on the notification,
 * another button, or a push that is not a Gate with two options.
 */
export function answerOfAction(
	actionId: string,
	data: PushData | null,
): ActionAnswer | null {
	if (data?.kind !== "gate-opened") return null;
	if (!data.runId || !data.stepId || data.options?.length !== 2) return null;
	const index =
		actionId === ACTION.approve ? 0 : actionId === ACTION.reject ? 1 : -1;
	const option = data.options[index];
	if (!option) return null;
	return { runId: data.runId, stepId: data.stepId, choice: option.id };
}

/** A notification the phone shows: its id, the Host's key when it is one of the Host's, when it came (ms). */
export type ShownNotification = { id: string; key: string | null; at: number };

/**
 * When a shown notification came, in ms. iOS reports seconds since 1970,
 * Android milliseconds: a number below 10^11 is seconds (before 1973 in ms).
 */
export function shownAtMs(date: number): number {
	return date < 1e11 ? Math.round(date * 1000) : date;
}

/** The shown notifications of one key: a withdraw push dismisses them. */
export function shownWithKey(
	shown: ShownNotification[],
	key: string,
): string[] {
	return shown.filter((item) => item.key === key).map((item) => item.id);
}

/**
 * The shown Gate notifications whose Gate no longer waits: someone answered
 * it, or its run ended. iOS may drop a withdraw push, so the phone clears
 * them when it reads the inbox. Only Gate keys (`runId:stepId`) count, and
 * only notifications that came before `readAt` with a margin: a read that
 * started before a push came does not know its Gate yet.
 */
export function shownButClosed(
	shown: ShownNotification[],
	openKeys: ReadonlySet<string>,
	readAt: number,
): string[] {
	return shown
		.filter((item) => item.at < readAt - READ_MARGIN_MS)
		.filter((item) => item.key !== null && isGateKey(item.key))
		.filter((item) => !openKeys.has(item.key as string))
		.map((item) => item.id);
}

/** How much older than the read a notification must be to count as answered. */
const READ_MARGIN_MS = 30_000;

/** A Gate's key is `runId:stepId`. A run's end has a third part, `waiting:` is not a Gate. */
function isGateKey(key: string): boolean {
	const parts = key.split(":");
	return parts.length === 2 && parts[0] !== "waiting";
}

/** Where the person is in the app, for a push that comes while the app is in front. */
export type InFrontPlace = {
	/** The pathname of the screen in front: `/` is the inbox. */
	pathname: string;
};

/**
 * Whether a push that comes while the app is in front shows as a banner in
 * the app. The phone never shows its own banner then: the app does it.
 * A Gate shows, unless the person already looks at the inbox or at that
 * Gate. A run's end shows nothing: the run list updates by itself.
 */
export function showInFront(data: PushData | null, place: InFrontPlace) {
	if (!data) return false;
	if (data.kind !== "gate-opened" && data.kind !== "gates-waiting") {
		return false;
	}
	if (place.pathname === "/") return false;
	if (data.runId && data.stepId) {
		return place.pathname !== `/gates/${data.runId}/${data.stepId}`;
	}
	return true;
}

/** Where a tap on a notification goes. */
export type PushRoute =
	| {
			pathname: "/gates/[runId]/[stepId]";
			params: { runId: string; stepId: string };
	  }
	| { pathname: "/runs/[runId]"; params: { runId: string } }
	| { pathname: "/" };

/** The screen a tap opens: the Gate, the run, or the inbox. */
export function routeOf(data: PushData | null): PushRoute | null {
	if (!data) return null;
	if (data.kind === "run-finished" || data.kind === "run-failed") {
		return data.runId
			? { pathname: "/runs/[runId]", params: { runId: data.runId } }
			: null;
	}
	if (data.kind === "gate-opened" && data.runId && data.stepId) {
		return {
			pathname: "/gates/[runId]/[stepId]",
			params: { runId: data.runId, stepId: data.stepId },
		};
	}
	return { pathname: "/" };
}

/**
 * Whether this phone may show Night Shift's notifications:
 * - `ask`: the person did not choose yet. The app explains, then asks.
 * - `on`: allowed (on iOS also "deliver quietly").
 * - `off`: the person said no. Only the Settings app of the phone can change it.
 */
export type PushPermission = "ask" | "on" | "off";

/** The permission, from what `expo-notifications` reports. */
export function permissionOf(status: {
	granted: boolean;
	canAskAgain: boolean;
	/** iOS: 3 is provisional, 4 ephemeral. Both deliver. */
	iosStatus?: number;
}): PushPermission {
	if (status.granted) return "on";
	if (status.iosStatus === 3 || status.iosStatus === 4) return "on";
	return status.canAskAgain ? "ask" : "off";
}
