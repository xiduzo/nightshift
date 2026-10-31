import { join } from "node:path";
import { Ollama } from "ollama";
import type { ConnectionStore, SettingsStore } from "../device-config";
import { type KnowledgeMeaning, ollamaMeaning } from "../knowledge";
import {
	knowledgeModel,
	OLLAMA_LOCAL,
	type OllamaEndpoint,
	resolveOllamaEndpoint,
} from "./endpoint";
import { createOllamaPulls } from "./pulls";
import { createOllamaStarter, type SpawnOllama } from "./starter";

/**
 * The Ollama Night Shift uses, for search by meaning and for Decision
 * nodes on Ollama. One place decides where it is (`resolveOllamaEndpoint`)
 * and which embedding model search uses (`knowledgeModel`).
 *
 * Night Shift starts `ollama serve` itself (`starter.ts`) when all hold:
 * - search by meaning is not off (`NIGHTSHIFT_OLLAMA=off`),
 * - no Ollama address is set (the owner's setting, or `OLLAMA_HOST`),
 * - this computer is a Host, or its owner turned the start on
 *   (`NIGHTSHIFT_OLLAMA=on`): a Host in a container has nobody to start
 *   Ollama, a person's computer already has its own way to run it,
 * - an `ollama` program is on PATH and nothing answers at 127.0.0.1:11434.
 *
 * Its models go in the data folder (`<dataDir>/ollama`). An Ollama Night
 * Shift started gets the embedding model on its first start, in the
 * background: search finds by words meanwhile.
 */

/** What the Settings page shows of the Ollama Night Shift uses. */
export type OllamaStatus = {
	/** Null: on this computer. Else the host name of its address. */
	where: string | null;
	/** Who chose the address: the owner's setting, the environment, or neither (this computer). */
	from: OllamaEndpoint["from"];
	/** Whether Night Shift runs this Ollama itself. */
	started: boolean;
	/** Whether Night Shift can start one: an `ollama` program is on this computer. */
	installed: boolean;
	/** Whether Ollama answers now. */
	answers: boolean;
	/** The embedding model search by meaning uses. */
	model: string;
	/** Whether this Ollama has that model. */
	hasModel: boolean;
	/** The download of the model, while it runs or when it failed. Null: none. */
	download: { percent: number; running: boolean; error: string | null } | null;
	/** The secrets the headers name that have no value. */
	missingSecrets: string[];
};

/** A model the Ollama has. */
export type OllamaModel = {
	name: string;
	/** Bytes on disk. */
	size: number;
	/** Whether it makes embeddings. Null: this Ollama does not say. */
	embedding: boolean | null;
};

/** How long a question to Ollama waits for an answer. */
const ASK_TIMEOUT_MS = 3_000;

export type OllamaService = Awaited<ReturnType<typeof createOllama>>;

export async function createOllama(deps: {
	dataDir: string;
	settings: Pick<SettingsStore, "current" | "view" | "onChange">;
	secrets: Pick<ConnectionStore, "expandEnv" | "onSecretsChange">;
	/** The environment of a started `ollama serve`. */
	env: Record<string, string | undefined>;
	/** Starts `ollama serve`: `Bun.spawn` by default. */
	spawn?: SpawnOllama;
	/** Finds a program on PATH: `Bun.which` by default. */
	which?: (name: string) => string | null;
	fetch?: typeof fetch;
	log?: (line: string) => void;
}) {
	const {
		dataDir,
		settings,
		secrets,
		env,
		spawn = bunSpawn,
		which = (name) => Bun.which(name),
		fetch: fetchImpl = fetch,
		log = (line) => console.info(line),
	} = deps;

	let endpoint: OllamaEndpoint = await resolveOllamaEndpoint({
		settings,
		secrets,
	});

	/** A client for `at`, each request bounded by `timeoutMs` when it is given. */
	function clientFor(at: OllamaEndpoint, timeoutMs?: number): Ollama {
		return new Ollama({
			host: at.address,
			headers: at.headers,
			fetch: ((input: string | URL | Request, init?: RequestInit) =>
				fetchImpl(input, {
					...init,
					...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
				})) as typeof fetch,
		});
	}

	async function answersAt(at: OllamaEndpoint): Promise<boolean> {
		try {
			await clientFor(at, ASK_TIMEOUT_MS).version();
			return true;
		} catch {
			return false;
		}
	}

	async function listAt(at: OllamaEndpoint): Promise<OllamaModel[]> {
		const { models } = await clientFor(at, ASK_TIMEOUT_MS).list();
		return models.map((m) => {
			const capabilities = (m as { capabilities?: unknown }).capabilities;
			return {
				name: m.name,
				size: m.size,
				embedding: Array.isArray(capabilities)
					? capabilities.includes("embedding")
					: null,
			};
		});
	}

	const has = (models: OllamaModel[], model: string) =>
		models.some((m) => m.name === model || m.name === `${model}:latest`);

	/** Counts up when a download ends: search asks Ollama again at once. */
	let downloads = 0;

	const pulls = createOllamaPulls({
		client: async () => clientFor(endpoint),
		onDone: () => {
			downloads += 1;
		},
		log,
	});

	const local: OllamaEndpoint = {
		address: OLLAMA_LOCAL,
		headers: {},
		secretValues: [],
		missing: [],
		where: null,
		from: "local",
	};

	/** Gets the embedding model into the Ollama Night Shift started, when it lacks it. */
	async function ensureModel(): Promise<void> {
		if (!starter.up() || endpoint.from !== "local") return;
		const model = knowledgeModel(settings);
		try {
			if (!has(await listAt(endpoint), model)) pulls.pull(model);
		} catch {}
	}

	const starter = createOllamaStarter({
		binary: () => which("ollama"),
		spawn,
		answers: () => answersAt(local),
		env,
		modelsDir: join(dataDir, "ollama"),
		host: new URL(OLLAMA_LOCAL).host,
		onUp: () => void ensureModel(),
		log: (line) => console.error(line),
	});

	/** Whether Night Shift should run an Ollama of its own now. */
	function shouldStart(): boolean {
		const s = settings.current();
		if (s.ollama === "off") return false;
		if (endpoint.from !== "local") return false;
		return s.ollama === "on" || s.host;
	}

	let stopped = false;
	/** Brings the started Ollama, and its model, in line with the settings. */
	async function apply(): Promise<void> {
		if (stopped) return;
		endpoint = await resolveOllamaEndpoint({ settings, secrets });
		if (stopped) return;
		if (shouldStart()) {
			starter.start();
			void ensureModel();
		} else if (starter.wanted()) {
			await starter.stop();
		}
	}
	let applying: Promise<void> = Promise.resolve();
	const reapply = () => {
		applying = applying.then(apply).catch((error) => {
			console.warn("[ollama] the settings did not apply:", error);
		});
	};
	const offSettings = settings.onChange(reapply);
	const offSecrets = secrets.onSecretsChange(reapply);
	await apply();

	/** The search's model for the endpoint and model now, made again when one changes. */
	let made: { key: string; meaning: KnowledgeMeaning } | null = null;

	return {
		/** Where Ollama is now, with its headers: for Decision nodes and the API. */
		endpoint(): OllamaEndpoint {
			return endpoint;
		},
		/** Search by meaning now. Null: it is off. */
		meaning(): KnowledgeMeaning | null {
			if (settings.current().ollama === "off") return null;
			const model = knowledgeModel(settings);
			const key = JSON.stringify([
				model,
				endpoint.address,
				endpoint.headers,
				downloads,
			]);
			if (made?.key !== key) {
				made = {
					key,
					meaning: ollamaMeaning({
						model,
						address: endpoint.address,
						headers: endpoint.headers,
						where: endpoint.where,
						downloading: () => pulls.percent(model),
						fetch: fetchImpl,
					}),
				};
			}
			return made.meaning;
		},
		/** The Ollama Night Shift uses, for the Settings page. Never throws. */
		async status(): Promise<OllamaStatus> {
			const at = endpoint;
			const model = knowledgeModel(settings);
			let answers = false;
			let models: OllamaModel[] = [];
			try {
				models = await listAt(at);
				answers = true;
			} catch {}
			const pull = pulls.of(model);
			return {
				where: at.where,
				from: at.from,
				started: starter.up(),
				installed: which("ollama") !== null,
				answers,
				model,
				hasModel: has(models, model),
				download:
					pull && (pull.running || pull.error)
						? {
								percent: pull.percent,
								running: pull.running,
								error: pull.error,
							}
						: null,
				missingSecrets: at.missing,
			};
		},
		/**
		 * The models this Ollama has that make embeddings, and the ones it
		 * does not say about. Empty when it does not answer.
		 */
		async models(): Promise<OllamaModel[]> {
			try {
				return (await listAt(endpoint)).filter((m) => m.embedding !== false);
			} catch {
				return [];
			}
		},
		/** Starts a download of `model` into this Ollama, in the background. */
		pull(model: string): void {
			pulls.pull(model);
		},
		/** Stops the downloads and the Ollama Night Shift started. */
		async stop(): Promise<void> {
			stopped = true;
			offSettings();
			offSecrets();
			await applying;
			await pulls.stop();
			await starter.stop();
		},
	};
}

/** `ollama serve` through Bun, its output read by the starter. */
const bunSpawn: SpawnOllama = (argv, { env }) => {
	const proc = Bun.spawn(argv, {
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exited: proc.exited,
		kill: (signal) => proc.kill(signal),
		stdout: proc.stdout,
		stderr: proc.stderr,
	};
};
