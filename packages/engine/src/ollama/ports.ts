/**
 * What Ollama needs of this computer's settings and secrets, as ports.
 * The settings capability fills them in the engine wire.
 */

export type OllamaSettingsPort = {
	current(): { embeddingModel: string; ollama: string };
	view(): {
		values: {
			ollamaAddress: string;
			ollamaHeaders: Record<string, string>;
		};
		fields: { ollamaAddress: { source: string } };
	};
	onChange(listener: () => void): () => void;
};

export type OllamaSecretsPort = {
	expandEnv(
		values: Record<string, string>,
	): Promise<
		| { ok: true; env: Record<string, string>; values: string[] }
		| { ok: false; missing: string[] }
	>;
	onSecretsChange(listener: () => void): () => void;
};
