import type { HarnessName } from "@nightshift/flows";
import { now } from "@nightshift/time";

import { inMemoryComputer } from "../../../access/computer/adapters/out/in-memory-computer";
import { inMemoryCliTools } from "../../../settings/cli-tools/adapters/out/in-memory-cli-tools";
import { inMemoryConnections } from "../../../settings/connections/adapters/out/in-memory-connections";
import { inMemoryProfiles } from "../../../settings/profiles/adapters/out/in-memory-profiles";
import { inMemorySettings } from "../../../settings/settings/adapters/out/in-memory-settings";
import type {
	AgentCatalog,
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

/** This computer's configuration: its real edits over the in-memory stores. */
function inMemoryStores() {
	return {
		settings: inMemorySettings(),
		profiles: inMemoryProfiles(),
		connections: inMemoryConnections(),
		cliTools: inMemoryCliTools(),
	};
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
		computerAccess: inMemoryComputer(),
		processes,
		programs: inMemoryPrograms({
			programs: over.programs ?? { curl: "/usr/bin/curl" },
		}),
		...inMemoryStores(),
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
		computerAccess: inMemoryComputer(),
		processes,
		programs: inMemoryPrograms({ programs: over.programs ?? {} }),
		...inMemoryStores(),
		ollama: inMemoryLocalOllama(over.ollama),
		here: inMemorySetupHere(over.here),
		wait: inMemoryWait(),
		localModel: { name: "llama3.2:latest", bytes: 2_000_000_000 },
		typesafeKey: "TYPESAFE_API_KEY",
		started: processes.started,
	};
}
