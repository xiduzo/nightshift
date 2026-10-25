/**
 * The runs that moved to this computer, taken over until they arrived.
 *
 * Which runs still arrive is read from the log (`RunHistory.arriving`):
 * their latest `WalkerMoved` names this computer, and this computer wrote
 * nothing to them since (its first event is `WalkerArrived`). So a
 * take-over that fails (the Host away, the archive without the run's
 * Checkpoint yet) is tried again, with a growing wait, and one that a
 * crash or a restart cut short is found again when the engine is ready.
 * A take-over repeats safely (`takeOver` in the engine).
 */
export type TakeOvers = {
	/** Looks for runs that arrive, and takes each over. */
	look(): void;
	/**
	 * Whether the run has arrived, or never moved here. A run that still
	 * arrives is taken over first.
	 */
	arrived(runId: string): Promise<boolean>;
	/** Stops the waits before the next tries. */
	close(): void;
};

export function createTakeOvers(deps: {
	/** Resolves when the engine is ready: recovery ran, and runs may be taken. */
	ready: Promise<void>;
	/** The runs that moved here and have not arrived, from the log. */
	arriving(): Promise<string[]>;
	/** Takes a run over: `PeerContext.takeOver`. */
	takeOver(runId: string): Promise<void>;
	/** The wait before the first try again. Default 2 s, doubling up to `maxRetryMs`. */
	firstRetryMs?: number;
	/** Default five minutes. */
	maxRetryMs?: number;
}): TakeOvers {
	const firstMs = deps.firstRetryMs ?? 2_000;
	const maxMs = deps.maxRetryMs ?? 5 * 60_000;
	let closed = false;
	/** The take-overs running now. */
	const running = new Map<string, Promise<void>>();
	/** Per run that failed: the next wait, and what it said, said once. */
	const failed = new Map<string, { waitMs: number; said: string }>();
	let retry: ReturnType<typeof setTimeout> | null = null;

	function take(runId: string): Promise<void> {
		const known = running.get(runId);
		if (known) return known;
		const attempt = deps
			.takeOver(runId)
			.then(
				() => {
					failed.delete(runId);
				},
				(error) => {
					const said = error instanceof Error ? error.message : String(error);
					const before = failed.get(runId);
					if (before?.said !== said) {
						console.error(
							`[devices] run ${runId} moved here but was not taken over yet, it is tried again:`,
							error,
						);
					}
					const waitMs = before ? Math.min(before.waitMs * 2, maxMs) : firstMs;
					failed.set(runId, { waitMs, said });
					later(waitMs);
				},
			)
			.finally(() => running.delete(runId));
		running.set(runId, attempt);
		return attempt;
	}

	/** Looks again after `ms`, unless a look comes sooner. */
	function later(ms: number) {
		if (closed) return;
		if (retry) clearTimeout(retry);
		const waits = [...failed.values()].map((f) => f.waitMs);
		retry = setTimeout(
			() => {
				retry = null;
				look();
			},
			Math.min(ms, ...waits),
		);
		retry.unref?.();
	}

	async function arrivingNow(): Promise<string[]> {
		try {
			return await deps.arriving();
		} catch (error) {
			console.error("[devices] the runs that moved here were not read:", error);
			later(firstMs);
			return [];
		}
	}

	function look(): void {
		if (closed) return;
		void deps.ready
			.then(async () => {
				for (const runId of await arrivingNow()) {
					if (closed) return;
					void take(runId);
				}
			})
			.catch(() => {
				// An engine that never got ready takes nothing over.
			});
	}

	// What a crash or the last daemon left: once the engine is ready.
	look();

	return {
		look,
		async arrived(runId) {
			await deps.ready;
			if (!(await deps.arriving()).includes(runId)) return true;
			await take(runId);
			return !(await deps.arriving()).includes(runId);
		},
		close() {
			closed = true;
			if (retry) clearTimeout(retry);
			retry = null;
		},
	};
}
