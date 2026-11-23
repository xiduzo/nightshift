import type { GateOption } from "../../contract";
import {
	gatesWaitingTitle,
	type NoticeKind,
	type NoticeWords,
	titleOf,
} from "./words";

/**
 * What one notification says, as the notifier builds it. The shape is the
 * channels' `NotificationMessage`: a message carries ids, what happened,
 * and one short sentence for the person. A screen asks Night Shift for
 * the rest.
 */

/** What a push about a Gate may show beyond its ids: its options, when the person may answer from the lock screen. */
export type GateFacts = { lockScreen: boolean; options: GateOption[] };

/** One notification, as a channel sends it. */
export type NoticeMessage = {
	key: string;
	kind: NoticeKind | "gates-waiting";
	spaceId: string | null;
	runId: string | null;
	stepId: string | null;
	title: string;
	body?: string;
	alert: boolean;
	count: number | null;
	gate?: GateFacts;
	toldInApp?: boolean;
	at: number;
};

/** The ids of one event: its Space, its run (empty for a missed schedule) and its step. */
export type NoticeIds = {
	spaceId: string;
	runId: string;
	stepId: string | null;
};

/**
 * The message of one event. `words`: what it says, when it says more than
 * the sentence of its kind. `alert` false: a screen only updates.
 */
export function noticeMessage(
	kind: NoticeKind,
	key: string,
	ids: NoticeIds,
	alert: boolean,
	at: number,
	words?: NoticeWords,
): NoticeMessage {
	return {
		key,
		kind,
		...ids,
		// A missed schedule names no run: its entry keeps an empty one.
		runId: ids.runId === "" ? null : ids.runId,
		title: words?.title ?? titleOf(kind),
		...(words?.body ? { body: words.body } : {}),
		alert,
		count: null,
		at,
	};
}

/**
 * What a push about a Gate shows the person: its options only when its
 * author marked it for the lock screen and the person may answer.
 */
export function gateFactsOf(
	gate: { lockScreen?: boolean; choices?: string[] } | undefined,
	mayAnswer: boolean,
): GateFacts {
	if (!gate?.lockScreen || !mayAnswer)
		return { lockScreen: false, options: [] };
	return {
		lockScreen: true,
		options: (gate.choices ?? []).map((name) => ({ id: name, label: name })),
	};
}

/** The claim of one push to one Person in the delivery log: once per key. It keeps the words a held push says later. */
export function claimOf(
	personId: string,
	key: string,
	kind: NoticeKind,
	ids: NoticeIds,
	words?: NoticeWords,
) {
	return {
		personId,
		key,
		kind,
		...ids,
		title: words?.title ?? null,
		body: words?.body ?? null,
	};
}

/** The words a held entry kept, as it went out the first time. Null: the sentence of its kind. */
export function keptWords(row: {
	title: string | null;
	body: string | null;
}): NoticeWords | undefined {
	return row.title === null
		? undefined
		: { title: row.title, ...(row.body ? { body: row.body } : {}) };
}

/** The push at the end of quiet hours to a screen that held more than one Gate. */
export function gatesWaitingMessage(
	key: string,
	count: number,
	at: number,
): NoticeMessage {
	return {
		key,
		kind: "gates-waiting",
		spaceId: null,
		runId: null,
		stepId: null,
		title: gatesWaitingTitle(count),
		alert: true,
		count,
		at,
	};
}
