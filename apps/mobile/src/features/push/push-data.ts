/**
 * What a push from the Host carries, and what the phone does with it. Pure:
 * the native parts (`notifications.ts`, `background.ts`) ask the phone, this
 * decides. The shapes follow the "Phone push contract" in
 * `docs/research/mobile.md`. What a push carries, its keys and where a tap
 * goes come from `@nightshift/client` (the push contract).
 */

import {
	PUSH_ACTION,
	type PushData,
	type PushRoute,
	type ShownNotification as Shown,
} from "@nightshift/client";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
		actionId === PUSH_ACTION.approve
			? 0
			: actionId === PUSH_ACTION.reject
				? 1
				: -1;
	const option = data.options[index];
	if (!option) return null;
	return { runId: data.runId, stepId: data.stepId, choice: option.id };
}

/** A notification the phone shows: its id, the Host's key when it is one of the Host's, when it came (ms). */
export type ShownNotification = Shown & { id: string };

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

/** Where the person is in the app, for a push that comes while the app is in front. */
export type InFrontPlace = {
	/** The pathname of the screen in front: `/inbox` is the inbox, `/` is Home. */
	pathname: string;
};

/**
 * Whether a notice that comes while the app is in front (a push, or an
 * item of the stream through the live cache) shows as a banner in the
 * app. The phone never shows its own banner then: the app does it.
 * A Gate shows, unless the person already looks at the inbox or at that
 * Gate. A run's end shows nothing: the run list updates by itself.
 */
export function showInFront(data: PushData | null, place: InFrontPlace) {
	if (!data) return false;
	if (data.kind !== "gate-opened" && data.kind !== "gates-waiting") {
		return false;
	}
	if (place.pathname === "/inbox") return false;
	if (data.runId && data.stepId) {
		return place.pathname !== `/gates/${data.runId}/${data.stepId}`;
	}
	return true;
}

/** A screen of the phone app, as Expo Router opens it. */
export type PhoneRoute =
	| {
			pathname: "/gates/[runId]/[stepId]";
			params: { runId: string; stepId: string };
	  }
	| { pathname: "/runs/[runId]"; params: { runId: string } }
	| { pathname: "/inbox" };

/**
 * The screen of a route: the Gate, the run, or the inbox (`/inbox`). The
 * inbox is a tab: go back to it with `router.dismissTo`, push the others.
 */
export function phoneRouteOf(route: PushRoute): PhoneRoute {
	switch (route.to) {
		case "gate":
			return {
				pathname: "/gates/[runId]/[stepId]",
				params: { runId: route.runId, stepId: route.stepId },
			};
		case "run":
			return { pathname: "/runs/[runId]", params: { runId: route.runId } };
		case "inbox":
			return { pathname: "/inbox" };
	}
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
