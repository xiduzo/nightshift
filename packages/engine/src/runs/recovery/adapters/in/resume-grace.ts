/**
 * The grace before the runs that startup recovery interrupted continue on
 * their own: one timer. Recovery hands it the runs (`keep`). The engine
 * arms it once it is ready (`arm`), so the grace counts from then, however
 * long its start took. When the grace ends, each run gets its resume.
 */

export type ResumeGraceDeps = {
	/** How long after `arm` the runs continue. */
	graceMs: number;
	/** Aborting it drops the timer and the runs it keeps: the engine stops. */
	signal?: AbortSignal;
	/** Resumes one run. It never throws. */
	resume(runId: string): Promise<void>;
};

export type ResumeGrace = {
	/** The runs to resume when the grace ends. They replace the runs kept before. */
	keep(runIds: readonly string[]): void;
	/** Starts the grace for the runs kept. Nothing to resume, or a stopped engine: no timer. */
	arm(): void;
};

export function resumeGrace(deps: ResumeGraceDeps): ResumeGrace {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let kept: string[] = [];
	deps.signal?.addEventListener("abort", () => clearTimeout(timer), {
		once: true,
	});
	return {
		keep(runIds) {
			kept = [...runIds];
		},
		arm() {
			const runs = kept;
			kept = [];
			if (runs.length === 0 || deps.signal?.aborted) return;
			timer = setTimeout(() => {
				for (const runId of runs) void deps.resume(runId);
			}, deps.graceMs);
			timer.unref?.();
		},
	};
}
