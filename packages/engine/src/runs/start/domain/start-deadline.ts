import { Refusal } from "@nightshift/refusal";

/**
 * How long a start may take, from its plan to its row. Each call to a
 * Device has its own, shorter limit (copying the project takes the
 * longest). This one catches any other wait, so a start that hangs frees
 * its place in the run cap and tells the person.
 */
export const START_DEADLINE_MS = 4 * 60_000;

/** Why a start that took too long gave up. */
export const START_TOO_LONG =
	"The run did not start in time. Check that its device is online, then start the run again.";

/**
 * Runs `work` until it settles or `ms` passes: then it is refused, and
 * `work` sees its signal aborted, so it writes nothing after that.
 */
export async function beforeDeadline<T>(
	ms: number,
	work: (deadline: AbortSignal) => Promise<T>,
): Promise<T> {
	const deadline = AbortSignal.timeout(ms);
	let onAbort = () => {};
	const late = new Promise<never>((_, reject) => {
		onAbort = () => reject(new Refusal("unavailable", START_TOO_LONG));
		deadline.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([work(deadline), late]);
	} finally {
		deadline.removeEventListener("abort", onAbort);
	}
}
