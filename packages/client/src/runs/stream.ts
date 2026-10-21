import type {
	RunStatus,
	RunStreamItem,
	StepSummary,
	TranscriptEntry,
} from "./types";

/** The state of the stream of one run, for a "Reconnecting" hint. */
export type RunStreamConnection = "connecting" | "live" | "reconnecting";

/**
 * The one procedure the stream needs: `runs.watch`. The client of
 * `createApiClient` has it, and a test passes a fake.
 */
export type RunWatchClient = {
	runs: {
		watch: (
			input: { runId: string; afterSeq?: number },
			options: { signal: AbortSignal },
		) => Promise<AsyncIterable<RunStreamItem>>;
	};
};

/** Waits `ms`, or less when `signal` aborts. */
export type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

export type FollowRunOptions = {
	client: RunWatchClient;
	runId: string;
	/** Stops the stream. `followRun` resolves soon after. */
	signal: AbortSignal;
	/** A transcript entry the caller does not have yet, in order. */
	onEntry: (entry: TranscriptEntry) => void;
	/** A step summary: new, or changed. */
	onStep: (step: StepSummary) => void;
	/** The run's status, at the start and when it changes. */
	onStatus: (status: RunStatus) => void;
	/** The state of the stream. */
	onConnection?: (connection: RunStreamConnection) => void;
	/** How to wait before a retry. Tests pass one that does not wait. */
	wait?: Wait;
};

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15_000;

/**
 * How long to wait before retry `attempt` (0 first): it doubles from 1 s up
 * to 15 s. An item from the stream sets the attempt back to 0.
 */
export function retryDelay(attempt: number): number {
	return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

/** Waits `ms`, or less when `signal` aborts: the wait of a stream between two tries. */
export const waitFor: Wait = (ms, signal) =>
	new Promise<void>((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		signal.addEventListener("abort", done, { once: true });
	});

/**
 * Follows `runs.watch` for one run until `signal` aborts. The server sends
 * the status and every step summary, replays the transcript, then streams
 * live items. When the stream drops or ends, it connects again with backoff
 * and passes the last seq it saw as `afterSeq`, so it gets only the entries
 * it does not have yet. An entry at or below that seq is dropped, so the
 * caller sees each entry once.
 */
export async function followRun({
	client,
	runId,
	signal,
	onEntry,
	onStep,
	onStatus,
	onConnection,
	wait = waitFor,
}: FollowRunOptions): Promise<void> {
	let lastSeq: number | undefined;
	let attempt = 0;
	onConnection?.("connecting");
	while (!signal.aborted) {
		try {
			const stream = await client.runs.watch(
				{ runId, afterSeq: lastSeq },
				{ signal },
			);
			onConnection?.("live");
			for await (const item of stream) {
				attempt = 0;
				switch (item.kind) {
					case "transcript":
						if (lastSeq !== undefined && item.entry.seq <= lastSeq) break;
						lastSeq = item.entry.seq;
						onEntry(item.entry);
						break;
					case "step":
						onStep(item.step);
						break;
					case "status":
						onStatus(item.status);
						break;
				}
			}
		} catch {
			// Dropped connection or server error: fall through to the retry.
		}
		if (signal.aborted) return;
		onConnection?.("reconnecting");
		const delay = retryDelay(attempt);
		attempt += 1;
		await wait(delay, signal);
	}
}
