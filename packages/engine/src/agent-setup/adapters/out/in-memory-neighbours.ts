import type { HarnessName } from "@nightshift/flows";
import { now } from "@nightshift/time";

import type {
	AgentCatalog,
	AgentConfig,
	DeciderConfig,
	LocalOllama,
	SetupHere,
	SignInChecks,
	Wait,
} from "../../application/ports";
import type { SetupFacts } from "../../domain/setup-runs";
import { inMemoryPrograms } from "./in-memory-programs";
import { inMemorySetupProcesses } from "./in-memory-setup-processes";

const CLAUDE: SetupFacts = {
	vendor: "Anthropic",
	installScript: "https://claude.ai/install.sh",
	installShell: "bash",
	installEnv: {},
	binDir: ".local/bin",
	signIn: ["auth", "login"],
	signInHosts: ["claude.ai", "claude.com", "anthropic.com"],
	signInIo: "pipes",
	program: "claude",
};

const CODEX: SetupFacts = {
	vendor: "OpenAI",
	installScript: "https://chatgpt.com/codex/install.sh",
	installShell: "sh",
	installEnv: { CODEX_NON_INTERACTIVE: "1" },
	binDir: ".local/bin",
	signIn: ["login"],
	signInHosts: ["openai.com", "chatgpt.com"],
	signInIo: "pipes",
	program: "codex",
};

const SETUPS: Record<string, { label: string; setup: SetupFacts }> = {
	"claude-code": { label: "Claude Code", setup: CLAUDE },
	codex: { label: "Codex", setup: CODEX },
};

export function inMemoryAgentCatalog(): AgentCatalog {
	return {
		all: () =>
			(Object.keys(SETUPS) as HarnessName[]).flatMap((harness) => {
				const row = SETUPS[harness];
				return row ? [{ harness, label: row.label, setup: row.setup }] : [];
			}),
		of: (harness) => SETUPS[harness]?.setup ?? null,
		label: (harness) => SETUPS[harness]?.label ?? harness,
		signInCommand: (bin, setup) => [bin, ...setup.signIn].join(" "),
	};
}

export function inMemoryAgentConfig(
	bins: Partial<Record<HarnessName, string>> = {},
) {
	const profiles: { harness: HarnessName; id: string; name: string }[] = [];
	let next = 1;
	const twin = {
		bin: (harness: HarnessName) =>
			bins[harness] ?? harness.replace("-code", ""),
		addProfile: async (harness: HarnessName, program: string) => {
			const existing = profiles.find((p) => p.harness === harness);
			if (existing) return { id: existing.id, name: existing.name };
			const added = {
				harness,
				id: `p-${next++}`,
				name: program.split("/").at(-1) ?? program,
			};
			profiles.push(added);
			return { id: added.id, name: added.name };
		},
		profiles,
	};
	return twin satisfies AgentConfig;
}

export function inMemorySignInChecks(
	...answers: Array<"signed_in" | "signed_out" | "unknown">
) {
	const asked: string[] = [];
	const remaining = [...answers];
	const twin: SignInChecks & { asked: string[] } = {
		asked,
		check: async (harness, bin) => {
			asked.push(`${harness} ${bin}`);
			const signIn = remaining.length > 1 ? remaining.shift() : remaining[0];
			return {
				signIn: signIn ?? "unknown",
				account: signIn === "signed_in" ? "ada@example.com" : null,
			};
		},
	};
	return twin;
}

export function inMemoryDeciderConfig() {
	const secrets = new Map<string, string>();
	const profiles = new Map<
		string,
		{
			id: string;
			name: string;
			description?: string;
			harness?: string;
			decider?: string;
			model?: string;
		}
	>();
	const values: {
		ollama: string;
		builtinAgents: { decider?: unknown; "brief-writer"?: unknown };
		decisionDecider: string;
		decisionDeciderSource: string;
	} = {
		ollama: "off",
		builtinAgents: {},
		decisionDecider: "ollama",
		decisionDeciderSource: "default",
	};
	let next = 1;
	const twin = {
		view: () => ({
			fields: { decisionDecider: { source: values.decisionDeciderSource } },
			values: { decisionDecider: values.decisionDecider },
		}),
		current: () => ({
			ollama: values.ollama,
			builtinAgents: values.builtinAgents,
		}),
		save: async (patch: Record<string, unknown>) => {
			if (typeof patch.ollama === "string") values.ollama = patch.ollama;
			if (typeof patch.decisionDecider === "string") {
				values.decisionDecider = patch.decisionDecider;
				values.decisionDeciderSource = "saved";
			}
			if (patch.builtinAgents && typeof patch.builtinAgents === "object") {
				values.builtinAgents =
					patch.builtinAgents as typeof values.builtinAgents;
			}
		},
		secretSource: (name: string) =>
			secrets.has(name) ? "keychain" : "missing",
		setSecret: async (name: string, value: string) => {
			secrets.set(name, value);
		},
		profileByName: (name: string) => {
			const found = [...profiles.values()].find((p) => p.name === name);
			return found ?? null;
		},
		saveProfile: async (profile: Record<string, unknown>, id?: string) => {
			const view = {
				id: id ?? `p-${next++}`,
				name: String(profile.name),
				description: profile.description
					? String(profile.description)
					: undefined,
				harness: profile.harness ? String(profile.harness) : undefined,
				decider: profile.decider ? String(profile.decider) : undefined,
				model: profile.model ? String(profile.model) : undefined,
			};
			profiles.set(view.id, view);
			return { id: view.id, name: view.name };
		},
		secrets,
		profiles,
	};
	return twin satisfies DeciderConfig;
}

export function inMemoryLocalOllama(
	start: {
		installed?: boolean;
		answers?: boolean;
		models?: string[];
		from?: string;
		where?: string | null;
	} = {},
) {
	const state = {
		installed: start.installed ?? true,
		answers: start.answers ?? true,
		models: start.models ?? [],
		from: start.from ?? "local",
		where: start.where ?? null,
		download: null as {
			percent: number;
			running: boolean;
			error: string | null;
		} | null,
		startsOnRefresh: true,
		pulls: [] as string[],
		cancelled: [] as string[],
		refreshes: 0,
	};
	const twin: LocalOllama & { state: typeof state } = {
		state,
		status: async (model) => ({
			where: state.where,
			from: state.from,
			installed: state.installed,
			answers: state.answers,
			hasModel: state.answers && state.models.includes(model),
			download: state.download,
		}),
		pull: (model) => {
			state.pulls.push(model);
			state.download = { percent: 0, running: true, error: null };
		},
		cancelPull: async (model) => {
			state.cancelled.push(model);
			state.download = null;
		},
		refresh: async () => {
			state.refreshes += 1;
			if (state.startsOnRefresh && state.installed) state.answers = true;
		},
	};
	return twin;
}

export function inMemoryWait(pollMs = 1): Wait {
	return {
		pause: () => new Promise((done) => setTimeout(done, pollMs)),
		now,
	};
}

export function inMemorySetupHere(over: Partial<SetupHere> = {}): SetupHere {
	return {
		container: false,
		platform: "darwin",
		home: "/home/ada",
		env: { PATH: "/usr/bin", HOME: "/home/ada" },
		...over,
	};
}

/** Every twin a use-case test of the guided setup starts from. */
export function inMemoryAgentSetupPorts(
	over: {
		programs?: Record<string, string>;
		checks?: Array<"signed_in" | "signed_out" | "unknown">;
		here?: Partial<SetupHere>;
		onStart?: Parameters<typeof inMemorySetupProcesses>[0];
	} = {},
) {
	const processes = inMemorySetupProcesses(over.onStart);
	return {
		processes,
		programs: inMemoryPrograms({
			programs: over.programs ?? { curl: "/usr/bin/curl" },
		}),
		config: inMemoryAgentConfig(),
		catalog: inMemoryAgentCatalog(),
		checks: inMemorySignInChecks(...(over.checks ?? ["signed_out"])),
		here: inMemorySetupHere(over.here),
		wait: inMemoryWait(),
		started: processes.started,
	};
}

export function inMemoryDeciderSetupPorts(
	over: {
		ollama?: Parameters<typeof inMemoryLocalOllama>[0];
		here?: Partial<SetupHere>;
		programs?: Record<string, string>;
		onStart?: Parameters<typeof inMemorySetupProcesses>[0];
	} = {},
) {
	const processes = inMemorySetupProcesses(over.onStart);
	return {
		processes,
		programs: inMemoryPrograms({ programs: over.programs ?? {} }),
		config: inMemoryDeciderConfig(),
		ollama: inMemoryLocalOllama(over.ollama),
		here: inMemorySetupHere(over.here),
		wait: inMemoryWait(),
		localModel: { name: "llama3.2:latest", bytes: 2_000_000_000 },
		typesafeKey: "TYPESAFE_API_KEY",
		started: processes.started,
	};
}
