import {
	type ConnectionStore,
	isLoopbackHost,
	type SettingsStore,
} from "../device-config";

/** Ollama's own address on this computer: where Night Shift starts it, and looks first. */
export const OLLAMA_LOCAL = "http://127.0.0.1:11434";

/** The Ollama Night Shift uses: for search by meaning and for Decision nodes. */
export type OllamaEndpoint = {
	/** `http://host:port`, without a trailing slash. */
	address: string;
	/** Sent with every request, secrets expanded. Never in a log or a session. */
	headers: Record<string, string>;
	/** The secret values in `headers`, to hide wherever output could show them. */
	secretValues: string[];
	/** The `${NAME}` references of the headers that have no value. Then `headers` is empty. */
	missing: string[];
	/** Null: on this computer. Else the host name of the address. */
	where: string | null;
	/**
	 * Who chose it: the owner's setting, `OLLAMA_HOST`, or neither: the
	 * Ollama on this computer, the one Night Shift started or the one that
	 * answers there.
	 */
	from: "setting" | "env" | "local";
};

/** Null for an address on this computer, else its host name. */
export function whereOf(address: string): string | null {
	try {
		const { hostname } = new URL(address);
		return isLoopbackHost(hostname) ? null : hostname;
	} catch {
		return address;
	}
}

/**
 * The one place that decides where Ollama is: the owner's "Ollama address"
 * setting, else `OLLAMA_HOST` (the settings store reads both, in that
 * order), else this computer, where Night Shift may start it. Headers come
 * from the setting with `${NAME}` expanded from the secrets.
 */
export async function resolveOllamaEndpoint(deps: {
	settings: Pick<SettingsStore, "current" | "view">;
	secrets: Pick<ConnectionStore, "expandEnv">;
}): Promise<OllamaEndpoint> {
	const { values, fields } = deps.settings.view();
	const set = values.ollamaAddress.trim();
	const address = (set || OLLAMA_LOCAL).replace(/\/+$/, "");
	const source = fields.ollamaAddress.source;
	const from = set === "" ? "local" : source === "saved" ? "setting" : "env";
	const where = whereOf(address);
	// Headers are for an Ollama elsewhere, behind a proxy: the one on this computer gets none.
	const wanted = from === "local" ? {} : values.ollamaHeaders;
	if (Object.keys(wanted).length === 0) {
		return { address, headers: {}, secretValues: [], missing: [], where, from };
	}
	const expanded = await deps.secrets.expandEnv(wanted);
	return expanded.ok
		? {
				address,
				headers: expanded.env,
				secretValues: expanded.values,
				missing: [],
				where,
				from,
			}
		: {
				address,
				headers: {},
				secretValues: [],
				missing: expanded.missing,
				where,
				from,
			};
}

/** The embedding model of search by meaning: the owner's setting, else `NIGHTSHIFT_EMBEDDING_MODEL`, else qwen3-embedding:0.6b. */
export function knowledgeModel(
	settings: Pick<SettingsStore, "current">,
): string {
	return settings.current().embeddingModel;
}
