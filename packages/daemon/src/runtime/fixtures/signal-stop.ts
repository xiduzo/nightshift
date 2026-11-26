/**
 * Run by `signals.test.ts`: a daemon's signal stop over an Ollama. It
 * starts `ollama serve` (the program in OLLAMA, which writes its pid and
 * its runner's in DIR) unless one answers already, then prints "ready".
 * OLLAMA_AT: the address of an Ollama the test started, which answers in
 * place of this computer's; without it none answers. HANG=1: the stop of
 * the other slots never ends.
 */
import { createOllama, killStartedOllama } from "@nightshift/engine";
import { lastingStop, stopOnSignals } from "../signals";

const at = process.env.OLLAMA_AT;
const ollama = await createOllama({
	dataDir: process.env.DIR ?? "",
	settings: {
		current: () => ({ embeddingModel: "m", ollama: "on", host: false }),
		view: () => ({
			values: { ollamaAddress: "", ollamaHeaders: {} },
			fields: { ollamaAddress: { source: "default" } },
		}),
		onChange: () => () => {},
	},
	secrets: {
		expandEnv: async () => ({ ok: true, env: {}, values: [] }),
		onSecretsChange: () => () => {},
	},
	env: { PATH: process.env.PATH, DIR: process.env.DIR },
	which: () => process.env.OLLAMA ?? null,
	fetch: (async (input: string | URL | Request, init?: RequestInit) => {
		if (!at) throw new TypeError("fetch failed: ECONNREFUSED");
		const url = new URL(input instanceof Request ? input.url : String(input));
		return fetch(`${at}${url.pathname}`, init);
	}) as typeof fetch,
	log: () => {},
});

const hang = process.env.HANG === "1";
stopOnSignals(
	lastingStop(async () => {
		if (hang) await new Promise(() => {});
		await ollama.stop();
	}),
	killStartedOllama,
);
console.log("ready");
