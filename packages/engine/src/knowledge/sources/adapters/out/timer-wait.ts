import type { Wait } from "../../application/ports";

/** A wait over Bun's timer. */
export function timerWait(): Wait {
	return { wait: (ms) => Bun.sleep(ms) };
}
