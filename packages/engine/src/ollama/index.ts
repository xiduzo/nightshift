/**
 * Ollama: where Night Shift finds it, the `ollama serve` it starts and
 * keeps running when it needs one, and the models it downloads into it.
 */

export type { OllamaEndpoint } from "./endpoint";
export {
	createOllama,
	type OllamaModel,
	type OllamaService,
	type OllamaStatus,
} from "./ollama";
