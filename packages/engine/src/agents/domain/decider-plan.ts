import {
	canMakeValue,
	type DeciderName,
	isAgentProfile,
	type ModelProfile,
	type Profile,
} from "@nightshift/flows";

/** How Ollama gets on this computer when it is not here. */
export type OllamaInstall =
	/** Homebrew installs it, after the person confirms. `command`: the exact text that runs. */
	| { kind: "brew"; command: string }
	/** The person downloads it from its page, then checks again. */
	| { kind: "download"; url: string };

/** The exact command that installs Ollama on a Mac with Homebrew. */
export const BREW_INSTALL = "brew install ollama";

/** Ollama's own download pages, where no install runs here. */
export const DOWNLOAD_PAGE: Readonly<Record<string, string>> = {
	darwin: "https://ollama.com/download/mac",
	linux: "https://ollama.com/download/linux",
};

/** Where a person gets a TypeSafe key. */
export const TYPESAFE_KEY_PAGE = "https://typesafe.ai";

/** The names of the Model Profiles the setup makes. */
export const LOCAL_PROFILE = "local";
export const TYPESAFE_PROFILE = "jev";

/** The longest key a person can paste. */
export const MAX_KEY = 1_000;

/** How many asks in a row may find no download and no model before the job gives up. */
export const QUIET_ASKS = 10;

export type OllamaPlanFacts = {
	container: boolean;
	platform: string;
	from: string;
	installed: boolean;
	answers: boolean;
	hasBrew: boolean;
};

/** How Ollama gets on this computer, or null when it is here or Night Shift uses one elsewhere. */
export function ollamaInstallOf(facts: OllamaPlanFacts): OllamaInstall | null {
	if (
		facts.container ||
		facts.from !== "local" ||
		facts.installed ||
		facts.answers
	) {
		return null;
	}
	if (facts.platform === "darwin" && facts.hasBrew) {
		return { kind: "brew", command: BREW_INSTALL };
	}
	const url = DOWNLOAD_PAGE[facts.platform];
	return url ? { kind: "download", url } : null;
}

/** The next free Model Profile name: `base`, else `base_2`, `base_3`, … */
export function nextModelName(
	base: string,
	taken: (name: string) => boolean,
): string {
	if (!taken(base)) return base;
	for (let n = 2; n < 10_000; n++) {
		const name = `${base}_${n}`;
		if (!taken(name)) return name;
	}
	return `${base}_9999`;
}

/**
 * Night Shift's own Decider, and its Brief writer when the model can
 * write, on the model profile the setup made. A choice the person made
 * in Settings stays.
 */
/** A Model Profile named `base`: the one of that name gets the settings, else a new one. */
export async function saveNamedModelProfile<
	T extends { id: string; name: string },
>(
	base: string,
	settings: Omit<ModelProfile, "name" | "description">,
	byName: (name: string) => (Profile & { id: string }) | null,
	save: (profile: ModelProfile, id?: string) => Promise<T>,
): Promise<T> {
	const named = byName(base);
	if (named && !isAgentProfile(named)) {
		return save(
			{
				name: named.name,
				...(named.description ? { description: named.description } : {}),
				...settings,
			},
			named.id,
		);
	}
	return save({
		name: nextModelName(base, (n) => byName(n) !== null),
		...settings,
	});
}

export function withModelAgents<
	T extends { decider?: unknown; "brief-writer"?: unknown },
>(chosen: T, profile: string, decider: DeciderName): T {
	const answer = { kind: "model" as const, profile };
	return {
		...chosen,
		...(chosen.decider ? {} : { decider: answer }),
		...(chosen["brief-writer"] || !canMakeValue(decider)
			? {}
			: { "brief-writer": answer }),
	};
}
