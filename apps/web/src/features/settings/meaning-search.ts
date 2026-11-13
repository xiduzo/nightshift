/**
 * Meaning search as Settings names it: the embedding models that work
 * well, the words of when it runs, and how its Ollama is now.
 */
import { useQuery } from "@tanstack/react-query";
import { ollamaQueries } from "./queries";

/** Embedding models that work well, with what each is good at. */
export const SHORTLIST: readonly { name: string; about: string }[] = [
	{ name: "qwen3-embedding:0.6b", about: "Default. Reads many languages." },
	{ name: "embeddinggemma", about: "Small. Reads many languages." },
	{ name: "bge-m3", about: "Reads many languages. Larger." },
	{ name: "nomic-embed-text", about: "English. Small and fast." },
];

/** How often the status is asked again while a download runs, and otherwise. */
const DOWNLOAD_POLL = 1500;
const STATUS_POLL = 15_000;

/** When Night Shift searches by meaning, in the words of the choice. A Host starts Ollama itself. */
export function ollamaModes(host: boolean) {
	return [
		{
			value: "auto",
			label: host ? "Start Ollama on this Host" : "Use Ollama when it runs",
		},
		{ value: "on", label: "Start Ollama with Night Shift" },
		{ value: "off", label: "Off: find by words only" },
	] as const;
}

/** How the Ollama of search is now. Asks again often while a download runs. */
export function useOllamaStatus() {
	return useQuery({
		...ollamaQueries.status(),
		refetchInterval: (query) =>
			query.state.data?.download?.running ? DOWNLOAD_POLL : STATUS_POLL,
	});
}
