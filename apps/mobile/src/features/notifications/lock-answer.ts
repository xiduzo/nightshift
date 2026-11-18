import type { ActionAnswer } from "./push-data";

/** Where an answer from the lock screen comes from. */
export const LOCK_SCREEN_VIA = "lock_screen" as const;

/** Adds the lock screen to an answer, for `gates.resolve`. */
export function lockScreenAnswer(answer: ActionAnswer) {
	return { ...answer, via: LOCK_SCREEN_VIA };
}
