import type { Ollama } from "ollama";

/**
 * Downloads of models into Ollama (`/api/pull`, streamed), in the
 * background, one per model, with how far each is. Ollama keeps what it
 * has downloaded: a download that stopped goes on where it was.
 */

/** A download of a model. */
export type OllamaPull = {
	model: string;
	/** From 0 to 100. */
	percent: number;
	/** Why the last download of the model failed. Null: it did not. */
	error: string | null;
	/** Whether it still runs. */
	running: boolean;
};

export type OllamaPulls = ReturnType<typeof createOllamaPulls>;

export function createOllamaPulls(options: {
	/** A client for the Ollama to download into. */
	client: () => Promise<Ollama>;
	/** Called when a download ends well. */
	onDone?: (model: string) => void;
	log?: (line: string) => void;
}) {
	const { client, onDone, log = (line) => console.info(line) } = options;
	const pulls = new Map<string, OllamaPull>();
	const running = new Map<string, Promise<void>>();
	let stopped = false;
	/** Stops each running download's stream, by model. */
	const aborts = new Map<string, () => void>();
	/** The models whose download a person cancelled: it ends without an error. */
	const cancelled = new Set<string>();

	async function run(model: string): Promise<void> {
		const pull: OllamaPull = { model, percent: 0, error: null, running: true };
		pulls.set(model, pull);
		/** Bytes per layer: the percent is over all of them. */
		const layers = new Map<string, { total: number; completed: number }>();
		try {
			const ollama = await client();
			const stream = await ollama.pull({ model, stream: true });
			aborts.set(model, () => stream.abort());
			// Cancelled while the download started: it stops before its first part.
			if (cancelled.has(model)) stream.abort();
			try {
				for await (const part of stream) {
					if (cancelled.has(model)) throw new Error("The download stopped.");
					if (part.digest && part.total > 0) {
						layers.set(part.digest, {
							total: part.total,
							completed: part.completed ?? 0,
						});
						let total = 0;
						let completed = 0;
						for (const layer of layers.values()) {
							total += layer.total;
							completed += layer.completed;
						}
						// A layer that shows up later grows the total: the percent never goes back.
						pull.percent = Math.max(
							pull.percent,
							Math.min(99, Math.floor((completed / Math.max(total, 1)) * 100)),
						);
					}
					if (part.status === "success") pull.percent = 100;
				}
			} finally {
				aborts.delete(model);
			}
			if (pull.percent < 100) throw new Error("The download ended early.");
			log(`[ollama] ${model} is downloaded.`);
			onDone?.(model);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const quiet = stopped || cancelled.has(model);
			pull.error = quiet ? null : message;
			if (!quiet) log(`[ollama] ${model} did not download: ${message}`);
		} finally {
			cancelled.delete(model);
			pull.running = false;
		}
	}

	return {
		/** Starts a download of `model`. Does nothing while one runs. */
		pull(model: string): void {
			if (stopped || running.has(model)) return;
			running.set(
				model,
				run(model).finally(() => running.delete(model)),
			);
		},
		/** The last download of `model`. Null: none since Night Shift started. */
		of(model: string): OllamaPull | null {
			return pulls.get(model) ?? null;
		},
		/** How far a running download of `model` is, in percent. Null: none runs. */
		percent(model: string): number | null {
			const pull = pulls.get(model);
			return pull?.running ? pull.percent : null;
		},
		/**
		 * Stops the download of `model`. Ollama keeps what came: the next
		 * download of it goes on from there.
		 */
		async cancel(model: string): Promise<void> {
			const download = running.get(model);
			if (!download) return;
			cancelled.add(model);
			aborts.get(model)?.();
			await download.catch(() => {});
		},
		/** Stops every download. */
		async stop(): Promise<void> {
			stopped = true;
			for (const abort of aborts.values()) abort();
			await Promise.allSettled(running.values());
		},
	};
}
