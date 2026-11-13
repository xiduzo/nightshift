import type { NeedsItem } from "./queue";

/**
 * Needs you shows one thing at a time. This is the order you go through
 * the queue, without React Native:
 * - The thing on screen is pinned. A new Gate that comes first does not
 *   take its place while you read it. It stays until you answer it, skip
 *   it or it leaves the queue. Then the first of the queue shows.
 * - Skip moves the thing to the end of the queue.
 * - A thing you answered or retried on this phone stays out of the queue
 *   while the live data still holds it. When it comes back changed (the
 *   run stopped again), it shows again.
 */

/** One thing you answered or retried, and the version you saw then. */
type Handled = { key: string; version: string };

export type FocusState = {
	/** The thing on screen. Null before the first one shows. */
	pinned: { key: string; kind: NeedsItem["kind"] } | null;
	/** The things you skipped, the first skipped first. They wait at the end. */
	skipped: readonly string[];
	handled: readonly Handled[];
};

export const FOCUS_START: FocusState = {
	pinned: null,
	skipped: [],
	handled: [],
};

/** What makes a thing new again: a Gate opens once, a run can stop again. */
export function versionOf(item: NeedsItem): string {
	return item.kind === "gate"
		? String(item.gate.openedAt)
		: String(item.run.endedAt ?? item.run.createdAt);
}

function isHandled(state: FocusState, item: NeedsItem): boolean {
	const version = versionOf(item);
	return state.handled.some(
		(done) => done.key === item.key && done.version === version,
	);
}

/**
 * The queue in the order you go through it: the things you did not skip
 * in queue order, then the things you skipped, the first skipped first.
 * The things you handled stay out.
 */
export function focusOrder(
	state: FocusState,
	items: readonly NeedsItem[],
): NeedsItem[] {
	const open = items.filter((item) => !isHandled(state, item));
	const skipped = new Set(state.skipped);
	const byKey = new Map(open.map((item) => [item.key, item]));
	return [
		...open.filter((item) => !skipped.has(item.key)),
		...state.skipped.flatMap((key) => {
			const item = byKey.get(key);
			return item ? [item] : [];
		}),
	];
}

export type FocusView = {
	/** The thing on screen. Null when nothing waits. */
	current: NeedsItem | null;
	/** Where it is in the queue, from 1. */
	position: number;
	total: number;
	/**
	 * The thing you read left the queue, and not by your hand on this
	 * screen: someone else answered it, or its run ended. Its kind, for
	 * the notice.
	 */
	vanished: NeedsItem["kind"] | null;
	/** The state to keep from now on. Null when it does not change. */
	settled: FocusState | null;
};

/** The thing to show now, where it is in the queue, and what changed. */
export function focusView(
	state: FocusState,
	items: readonly NeedsItem[],
): FocusView {
	const order = focusOrder(state, items);
	const pinned = state.pinned
		? (order.find((item) => item.key === state.pinned?.key) ?? null)
		: null;
	const current = pinned ?? order[0] ?? null;
	const left = new Set(items.map((item) => item.key));
	const handledNow =
		state.pinned !== null &&
		state.handled.some((done) => done.key === state.pinned?.key);
	const vanished =
		state.pinned && !pinned && !handledNow ? state.pinned.kind : null;

	const skipped = state.skipped.filter((key) => left.has(key));
	const handled = state.handled.filter((done) => left.has(done.key));
	const changed =
		(current?.key ?? null) !== (state.pinned?.key ?? null) ||
		skipped.length !== state.skipped.length ||
		handled.length !== state.handled.length;

	return {
		current,
		position: current ? order.indexOf(current) + 1 : 0,
		total: order.length,
		vanished,
		settled: changed
			? {
					pinned: current ? { key: current.key, kind: current.kind } : null,
					skipped,
					handled,
				}
			: null,
	};
}

/** Skip: the thing goes to the end of the queue, and the first of the queue shows. */
export function skip(state: FocusState, key: string): FocusState {
	return {
		...state,
		pinned: null,
		skipped: [...state.skipped.filter((each) => each !== key), key],
	};
}

/** You answered or retried the thing: it leaves the queue, and the first of the queue shows. */
export function handle(state: FocusState, item: NeedsItem): FocusState {
	return {
		pinned: null,
		skipped: state.skipped.filter((key) => key !== item.key),
		handled: [
			...state.handled.filter((done) => done.key !== item.key),
			{ key: item.key, version: versionOf(item) },
		],
	};
}

/**
 * You let the thing go another way (you left a run): the first of the
 * queue shows. The thing comes back if it returns to the queue (Undo).
 */
export function release(state: FocusState): FocusState {
	return { ...state, pinned: null };
}
