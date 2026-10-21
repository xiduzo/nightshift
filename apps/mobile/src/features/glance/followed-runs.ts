import * as SecureStore from "expo-secure-store";

import type { FollowedRun, FollowedRunStore } from "./follow";

/** The SecureStore key of the runs this phone follows on the lock screen. */
const KEY = "nightshift.glance.followed";

let runs: readonly FollowedRun[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function changed(next: readonly FollowedRun[]): void {
	runs = next;
	for (const listener of listeners) listener();
	void SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => {});
}

function isFollowedRun(value: unknown): value is FollowedRun {
	if (typeof value !== "object" || value === null) return false;
	const run = value as Record<string, unknown>;
	return (
		typeof run.runId === "string" &&
		typeof run.host === "string" &&
		typeof run.key === "string"
	);
}

/**
 * Reads the followed runs from the phone once, so the app takes up the
 * Live Activities and notifications it showed before it closed.
 */
export function loadFollowedRuns(): Promise<void> {
	loaded ??= SecureStore.getItemAsync(KEY)
		.then((text) => {
			const saved: unknown = text ? JSON.parse(text) : [];
			if (Array.isArray(saved) && runs.length === 0) {
				runs = saved.filter(isFollowedRun);
				for (const listener of listeners) listener();
			}
		})
		.catch(() => {});
	return loaded;
}

/** The followed runs of this phone, kept in SecureStore. */
export const followedRuns: FollowedRunStore & {
	subscribe(listener: () => void): () => void;
} = {
	list: () => runs,
	add: (run) =>
		changed([...runs.filter((known) => known.runId !== run.runId), run]),
	remove: (runId) => {
		if (runs.some((run) => run.runId === runId)) {
			changed(runs.filter((run) => run.runId !== runId));
		}
	},
	subscribe: (listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};
