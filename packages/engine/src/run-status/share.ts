/**
 * The share of ended runs that finished, in whole percent. A stopped or
 * failed run counts against it. No ended runs: no share (`null`).
 */
export function finishedShare(finished: number, ended: number): number | null {
	return ended > 0 ? Math.round((finished / ended) * 100) : null;
}
