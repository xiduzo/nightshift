import { useEffect, useSyncExternalStore } from "react";

/** The last answer this phone sent: the inbox confirms it for a moment. */
export type Answered = { choice: string; runTitle: string; at: number };

/** How long the inbox shows the confirmation. */
const SHOWN_MS = 4000;

let last: Answered | null = null;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

/** The answer sheet calls this after a sent answer, then goes back. */
export function confirmAnswer(answer: Omit<Answered, "at">): void {
	last = { ...answer, at: Date.now() };
	emit();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The answer to confirm now, or null. It goes away after a few seconds. */
export function useAnswered(): Answered | null {
	const answered = useSyncExternalStore(subscribe, () => last);
	useEffect(() => {
		if (!answered) return;
		const left = answered.at + SHOWN_MS - Date.now();
		const timer = setTimeout(
			() => {
				if (last === answered) {
					last = null;
					emit();
				}
			},
			Math.max(0, left),
		);
		return () => clearTimeout(timer);
	}, [answered]);
	return answered;
}
