/**
 * The listener of the look back (ADR 37): each run this computer walks
 * that ends is looked back at, in the queue of the bound use case. A look
 * that fails is logged, and the run is not looked at again. The Walker
 * does it, so a Host looks back at its own runs and a Device at the runs
 * it walks: the run's transcripts are there.
 */

/** What the listener reads of the runs on this computer. */
export type EndedRunsFeed = {
	onLandedFacts(
		listener: (
			facts: readonly { kind: string; spaceId: string; runId: string }[],
		) => void,
	): () => void;
	runHere(runId: string): Promise<{ walkedHere: boolean } | null>;
};

/** Looks back at each run this computer walks when it ends. Returns the stop. */
export function followEndedRuns(
	runs: EndedRunsFeed,
	lookBack: (request: { spaceId: string; runId: string }) => Promise<unknown>,
): () => void {
	return runs.onLandedFacts((facts) => {
		for (const fact of facts) {
			if (fact.kind !== "run-ended") continue;
			void (async () => {
				const here = await runs.runHere(fact.runId);
				if (!here?.walkedHere) return;
				await lookBack({ spaceId: fact.spaceId, runId: fact.runId });
			})().catch((error: unknown) => {
				console.warn("Night Shift did not look back at a run:", error);
			});
		}
	});
}
