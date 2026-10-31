import { useSyncExternalStore } from "react";

import { keptStore } from "@/shared/api";

/** The runs you left: "Leave it" takes a run that stopped off Needs you. */
const KEY = "nightshift.left-runs";

/** The newest ones only: a run ends up out of the queue after a day anyway. */
const KEEP = 100;

let left: readonly string[] = read();
const listeners = new Set<() => void>();

function read(): string[] {
	try {
		const value = JSON.parse(keptStore.getItem(KEY) ?? "[]");
		return Array.isArray(value)
			? value.filter((id): id is string => typeof id === "string")
			: [];
	} catch {
		return [];
	}
}

function write(next: readonly string[]): void {
	left = next;
	for (const listener of listeners) listener();
	void keptStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => {});
}

/** Takes a run off Needs you on this phone. It stays in Runs. */
export function leaveRun(runId: string): void {
	if (left.includes(runId)) return;
	write([runId, ...left].slice(0, KEEP));
}

/** Puts a run you left back on Needs you: the Undo of "Leave it". */
export function unleaveRun(runId: string): void {
	write(left.filter((id) => id !== runId));
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function snapshot(): readonly string[] {
	return left;
}

/** The ids of the runs you left, kept on this phone. */
export function useLeftRuns(): readonly string[] {
	return useSyncExternalStore(subscribe, snapshot);
}
