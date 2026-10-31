/**
 * `ollama serve` as a child of Night Shift: started when Night Shift needs
 * an Ollama on this computer and none answers there, started again with a
 * growing wait when it ends, stopped when Night Shift stops. The rest of
 * Night Shift sees only an address that answers: the child's output goes
 * to the log, and only its errors.
 */

/** A started `ollama serve`, as the starter needs it. Tests pass a fake. */
export type OllamaChild = {
	/** Its exit code, once it ends. */
	exited: Promise<number | null>;
	kill(signal?: NodeJS.Signals): void;
	stdout?: ReadableStream<Uint8Array> | null;
	stderr?: ReadableStream<Uint8Array> | null;
};

/** Starts a program: `Bun.spawn` in Night Shift, a fake in tests. */
export type SpawnOllama = (
	argv: string[],
	options: { env: Record<string, string> },
) => OllamaChild;

export type OllamaStarterOptions = {
	/** The `ollama` program on PATH. Null: there is none, nothing starts. */
	binary: () => string | null;
	spawn: SpawnOllama;
	/** Whether an Ollama answers on this computer now. */
	answers: () => Promise<boolean>;
	/** The child's environment: PATH, HOME and the like. */
	env: Record<string, string | undefined>;
	/** Where the child keeps its models: in Night Shift's data folder. */
	modelsDir: string;
	/** The child's address, `host:port`. */
	host: string;
	/** Called once each time a started child answers. */
	onUp?: () => void;
	/** One line of the log. */
	log?: (line: string) => void;
	/** The first wait before a start again, then doubled up to `maxWaitMs`. */
	firstWaitMs?: number;
	maxWaitMs?: number;
	/** A child that ran this long starts the waits from the first again. */
	stableMs?: number;
	/** How long a stop waits for the child before it kills it. */
	stopWaitMs?: number;
	/** How long a start waits for the child to answer. */
	upWaitMs?: number;
};

/** Lines of the child's output that the log gets: its errors. */
const ERROR_LINE = /level=(ERROR|FATAL)|\bpanic:|^Error:|\bfatal error\b/i;

/** The prefix of each line the child writes to the log. */
const PREFIX = "[ollama]";

export type OllamaStarter = ReturnType<typeof createOllamaStarter>;

export function createOllamaStarter(options: OllamaStarterOptions) {
	const {
		binary,
		spawn,
		answers,
		env,
		modelsDir,
		host,
		onUp,
		log = (line) => console.error(line),
		firstWaitMs = 1_000,
		maxWaitMs = 60_000,
		stableMs = 60_000,
		stopWaitMs = 5_000,
		upWaitMs = 30_000,
	} = options;

	let wanted = false;
	let child: OllamaChild | null = null;
	/** The loop that keeps the child running, while it is wanted. */
	let loop: Promise<void> | null = null;
	/** Ends the wait between starts early, on a stop. */
	let wake: (() => void) | null = null;
	/** Whether the child Night Shift started answers. */
	let up = false;

	const sleep = (ms: number) =>
		new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, ms);
			wake = () => {
				clearTimeout(timer);
				resolve();
			};
		}).finally(() => {
			wake = null;
		});

	/** Forwards the error lines of a stream of the child to the log. */
	async function forward(
		stream: ReadableStream<Uint8Array> | null | undefined,
	) {
		if (!stream) return;
		const decoder = new TextDecoder();
		let rest = "";
		try {
			for await (const chunk of stream) {
				rest += decoder.decode(chunk, { stream: true });
				const lines = rest.split("\n");
				rest = lines.pop() ?? "";
				for (const line of lines) {
					if (ERROR_LINE.test(line)) log(`${PREFIX} ${line.trim()}`);
				}
			}
		} catch {}
		if (ERROR_LINE.test(rest)) log(`${PREFIX} ${rest.trim()}`);
	}

	/** Waits until the child answers, ends, or the start is no longer wanted. */
	async function awaitUp(started: OllamaChild): Promise<boolean> {
		let ended = false;
		void started.exited.then(() => {
			ended = true;
		});
		const until = Date.now() + upWaitMs;
		while (wanted && !ended && Date.now() < until) {
			if (await answers()) return true;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		return false;
	}

	async function keepRunning(): Promise<void> {
		let wait = firstWaitMs;
		while (wanted) {
			const program = binary();
			if (!program) {
				log(
					`${PREFIX} Night Shift did not start Ollama: no ollama program on PATH.`,
				);
				return;
			}
			// Another Ollama answers here: use it, start none.
			if (await answers()) {
				await sleep(maxWaitMs);
				continue;
			}
			if (!wanted) return;
			const started = spawn([program, "serve"], {
				env: {
					...Object.fromEntries(
						Object.entries(env).filter(
							(entry): entry is [string, string] => entry[1] !== undefined,
						),
					),
					OLLAMA_HOST: host,
					OLLAMA_MODELS: modelsDir,
				},
			});
			child = started;
			const since = Date.now();
			void forward(started.stdout);
			void forward(started.stderr);
			if (await awaitUp(started)) {
				up = true;
				onUp?.();
			}
			const code = await started.exited;
			up = false;
			child = null;
			if (!wanted) return;
			if (Date.now() - since >= stableMs) wait = firstWaitMs;
			log(
				`${PREFIX} Ollama stopped (exit ${code ?? "signal"}). Night Shift starts it again in ${Math.round(wait / 1000)} s.`,
			);
			await sleep(wait);
			wait = Math.min(wait * 2, maxWaitMs);
		}
	}

	return {
		/** Starts the child and keeps it running. Does nothing when it already runs. */
		start(): void {
			wanted = true;
			loop ??= keepRunning().finally(() => {
				loop = null;
			});
		},
		/** Stops the child, and waits until it ended. */
		async stop(): Promise<void> {
			wanted = false;
			wake?.();
			const running = child;
			if (running) {
				running.kill("SIGTERM");
				const ended = await Promise.race([
					running.exited.then(() => true),
					new Promise<false>((resolve) =>
						setTimeout(() => resolve(false), stopWaitMs),
					),
				]);
				if (!ended) running.kill("SIGKILL");
			}
			await loop;
		},
		/** Whether the Ollama Night Shift started runs and answers. */
		up(): boolean {
			return up;
		},
		/** Whether Night Shift keeps an Ollama running. */
		wanted(): boolean {
			return wanted;
		},
	};
}
