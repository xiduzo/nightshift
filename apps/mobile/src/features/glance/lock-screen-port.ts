import type { RunProgress } from "@nightshift/client";

/**
 * Where this phone shows one run's progress outside the app: a Live
 * Activity on iOS, an ongoing notification on Android. Each platform has
 * its own file (`lock-screen.ios.tsx`, `lock-screen.android.tsx`); tests
 * use a fake.
 */
export type LockScreenPort = {
	/** Whether this phone can show a run outside the app. */
	readonly available: boolean;
	/** What to tell the person when the phone does not let Night Shift show it. */
	readonly refusedText: string;
	/** Asks the person for leave when the system needs it. False when they say no. */
	allow(): Promise<boolean>;
	/** Shows the run. Returns the key to update it with. Throws when the system refuses. */
	show(runId: string, progress: RunProgress): Promise<string>;
	/** Shows new progress. False when it is gone: the person removed it. */
	update(key: string, progress: RunProgress): Promise<boolean>;
	/** Shows the end of the run, then lets the system remove it after a while. */
	end(key: string, progress: RunProgress): Promise<void>;
	/** Removes it now: the person stopped following the run. */
	remove(key: string): Promise<void>;
};

/** A phone that cannot show a run outside the app (the web build). */
export const NO_LOCK_SCREEN: LockScreenPort = {
	available: false,
	refusedText: "This device cannot show a run on the lock screen.",
	allow: async () => false,
	show: async () => {
		throw new Error("No lock screen");
	},
	update: async () => false,
	end: async () => {},
	remove: async () => {},
};
