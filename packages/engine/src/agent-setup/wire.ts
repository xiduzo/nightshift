import { homedir } from "node:os";
import {
	HARNESS_LABELS,
	harnessSetup,
	shellQuote,
} from "@nightshift/agents/harness-facts";
import { findProgram } from "@nightshift/agents/types";
import type { HarnessName } from "@nightshift/flows";
import { now } from "@nightshift/time";

import { NIGHT_SHIFT } from "../contract";
import {
	agentProfileOn,
	type ConfigStores,
	HARNESS_BIN,
	saveProfile,
} from "../device-config";
import type { OllamaService } from "../ollama";
import {
	bunSetupProcesses,
	type SetupSpawn,
	setupProcessesOver,
} from "./adapters/out/bun-setup-processes";
import { nodePrograms } from "./adapters/out/node-programs";
import { cancelAgentSetup } from "./application/cancel-agent-setup";
import { cancelDeciderSetup } from "./application/cancel-decider-setup";
import { installAgent } from "./application/install-agent";
import { installOllama } from "./application/install-ollama";
import type {
	AgentCatalog,
	AgentConfig,
	DeciderConfig,
	LocalOllama,
	Programs,
	SetupHere,
	SetupProcesses,
	SignInChecks,
	Wait,
} from "./application/ports";
import { readAgentSetup } from "./application/read-agent-setup";
import { readDeciderSetup } from "./application/read-decider-setup";
import { sendSignInCode } from "./application/send-sign-in-code";
import { signInAgent } from "./application/sign-in-agent";
import { stopAgentSetups } from "./application/stop-agent-setups";
import { stopDeciderSetups } from "./application/stop-decider-setups";
import { useLocalDecider } from "./application/use-local-decider";
import { useTypesafeDecider } from "./application/use-typesafe-decider";
import type {
	AgentSetupCaller,
	AgentSetupStatus,
	AgentSetupView,
} from "./domain/agent-status";
import type { DeciderSetupStatus } from "./domain/decider-status";
import { createAgentJobs, createDeciderJob } from "./domain/setup-jobs";
import type { SetupFacts } from "./domain/setup-runs";

/** What a sign-in check gives: a `CliCheck` of `@nightshift/agents` fits. */
export type SignInCheck = {
	signIn: "signed_in" | "signed_out" | "unknown";
	account: string | null;
};

export type AgentSetup = {
	status(caller: AgentSetupCaller): AgentSetupStatus;
	install(harness: HarnessName, caller: AgentSetupCaller): AgentSetupView;
	signIn(harness: HarnessName, caller: AgentSetupCaller): AgentSetupView;
	sendCode(
		harness: HarnessName,
		code: string,
		caller: AgentSetupCaller,
	): AgentSetupView;
	cancel(harness: HarnessName, caller: AgentSetupCaller): AgentSetupView;
	stop(): void;
};

export type DeciderSetup = {
	status(caller: AgentSetupCaller): Promise<DeciderSetupStatus>;
	installOllama(caller: AgentSetupCaller): Promise<DeciderSetupStatus>;
	useLocal(caller: AgentSetupCaller): Promise<DeciderSetupStatus>;
	useTypesafe(
		key: string | null,
		caller: AgentSetupCaller,
	): Promise<DeciderSetupStatus>;
	cancel(caller: AgentSetupCaller): Promise<DeciderSetupStatus>;
	stop(): void;
};

export type AgentSetupDeps = {
	stores: Pick<
		ConfigStores,
		"settings" | "profiles" | "connections" | "cliTools"
	>;
	check(harness: HarnessName, bin: string): Promise<SignInCheck>;
	container: boolean;
	platform?: NodeJS.Platform;
	home?: string;
	env?: Record<string, string | undefined>;
	which?: (program: string) => string | null;
	spawn?: SetupSpawn;
	installTimeoutMs?: number;
	signInTimeoutMs?: number;
};

export type DeciderSetupDeps = {
	stores: Pick<
		ConfigStores,
		"settings" | "profiles" | "connections" | "cliTools"
	>;
	ollama: Pick<OllamaService, "status" | "pull" | "cancelPull" | "refresh">;
	localModel: { readonly name: string; readonly bytes: number };
	typesafeKey: string;
	container: boolean;
	platform?: NodeJS.Platform;
	home?: string;
	env?: Record<string, string | undefined>;
	which?: (program: string) => string | null;
	spawn?: SetupSpawn;
	installTimeoutMs?: number;
	startTimeoutMs?: number;
	pollMs?: number;
};

/** What the daemon and the tests give the guided setups. */
export type AgentSetupWireDeps = AgentSetupDeps &
	Partial<
		Pick<
			DeciderSetupDeps,
			"ollama" | "localModel" | "typesafeKey" | "startTimeoutMs" | "pollMs"
		>
	>;

function catalog(): AgentCatalog {
	return {
		all: () =>
			(Object.keys(HARNESS_BIN) as HarnessName[]).flatMap((harness) => {
				const setup = harnessSetup(harness);
				return setup
					? [
							{
								harness,
								label: HARNESS_LABELS[harness],
								setup: setup as SetupFacts,
							},
						]
					: [];
			}),
		of: (harness) => (harnessSetup(harness) as SetupFacts | null) ?? null,
		label: (harness) => HARNESS_LABELS[harness],
		signInCommand: (bin, setup) => [shellQuote(bin), ...setup.signIn].join(" "),
	};
}

function agentConfig(stores: AgentSetupDeps["stores"]): AgentConfig {
	return {
		bin: (harness) => String(stores.settings.current()[HARNESS_BIN[harness]]),
		addProfile: (harness, program) => agentProfileOn(stores, harness, program),
	};
}

function deciderConfig(stores: AgentSetupDeps["stores"]): DeciderConfig {
	return {
		view: () => stores.settings.view(),
		current: () => stores.settings.current(),
		save: async (patch) => {
			await stores.settings.save(patch);
		},
		secretSource: (name) => stores.connections.secretSource(name),
		setSecret: (name, value) => stores.connections.setSecret(name, value),
		profileByName: (name) => stores.profiles.byName(name),
		saveProfile: (profile, id) =>
			saveProfile(
				stores,
				profile as Parameters<typeof saveProfile>[1],
				id === undefined ? {} : { id },
			),
	};
}

function hereOf(deps: {
	container: boolean;
	platform?: NodeJS.Platform;
	home?: string;
	env?: Record<string, string | undefined>;
	installTimeoutMs?: number;
	signInTimeoutMs?: number;
	startTimeoutMs?: number;
}): SetupHere {
	const env = deps.env ?? process.env;
	return {
		container: deps.container,
		platform: deps.platform ?? process.platform,
		home: deps.home ?? (env.HOME || homedir()),
		env,
		...(deps.installTimeoutMs !== undefined
			? { installTimeoutMs: deps.installTimeoutMs }
			: {}),
		...(deps.signInTimeoutMs !== undefined
			? { signInTimeoutMs: deps.signInTimeoutMs }
			: {}),
		...(deps.startTimeoutMs !== undefined
			? { startTimeoutMs: deps.startTimeoutMs }
			: {}),
	};
}

function waitOf(pollMs?: number): Wait {
	return {
		pause: () => new Promise((done) => setTimeout(done, pollMs ?? 500)),
		now,
	};
}

function processesOf(deps: {
	spawn?: SetupSpawn;
	installTimeoutMs?: number;
	signInTimeoutMs?: number;
}): SetupProcesses {
	const timeouts = {
		...(deps.installTimeoutMs !== undefined
			? { installTimeoutMs: deps.installTimeoutMs }
			: {}),
		...(deps.signInTimeoutMs !== undefined
			? { signInTimeoutMs: deps.signInTimeoutMs }
			: {}),
	};
	return deps.spawn
		? setupProcessesOver(deps.spawn, timeouts)
		: bunSetupProcesses(timeouts);
}

function programsOf(deps: {
	home: string;
	env: Record<string, string | undefined>;
	which?: (program: string) => string | null;
}): Programs {
	return nodePrograms({
		home: deps.home,
		env: deps.env,
		...(deps.which ? { which: deps.which } : {}),
	});
}

/**
 * The guided setups of an agent CLI and of a decider, bound to their
 * ports. The daemon calls it; tests pass a fake spawn.
 */
export function wireAgentSetup(deps: AgentSetupWireDeps): {
	agent: AgentSetup;
	decider: DeciderSetup;
} {
	const here = hereOf(deps);
	const processes = processesOf(deps);
	const programs = programsOf({
		home: here.home,
		env: here.env,
		which: deps.which ?? findProgram,
	});
	const agentJobs = createAgentJobs();
	const deciderJob = createDeciderJob();
	const cat = catalog();
	const config = agentConfig(deps.stores);
	const checks: SignInChecks = { check: deps.check };
	const actor = NIGHT_SHIFT;
	const agentPorts = {
		catalog: cat,
		config,
		programs,
		processes,
		checks,
		here,
		jobs: agentJobs,
	};
	const readAgent = readAgentSetup(agentPorts);
	const install = installAgent(agentPorts);
	const signIn = signInAgent(agentPorts);
	const sendCode = sendSignInCode(agentPorts);
	const cancelAgent = cancelAgentSetup(agentPorts);
	const stopAgents = stopAgentSetups({ jobs: agentJobs });

	const agent: AgentSetup = {
		status: (caller) => readAgent(actor, caller),
		install: (harness, caller) => install(actor, { harness, ...caller }),
		signIn: (harness, caller) => signIn(actor, { harness, ...caller }),
		sendCode: (harness, code, caller) =>
			sendCode(actor, { harness, code, ...caller }),
		cancel: (harness, caller) => cancelAgent(actor, { harness, ...caller }),
		stop: () => stopAgents({}),
	};

	const ollama: LocalOllama = deps.ollama ?? {
		status: async () => ({
			where: null,
			from: "local",
			installed: false,
			answers: false,
			hasModel: false,
			download: null,
		}),
		pull: () => {},
		cancelPull: async () => {},
		refresh: async () => {},
	};
	const deciderPorts = {
		config: deciderConfig(deps.stores),
		ollama,
		programs,
		processes,
		here,
		wait: waitOf(deps.pollMs),
		job: deciderJob,
		localModel: deps.localModel ?? { name: "", bytes: 0 },
		typesafeKey: deps.typesafeKey ?? "",
	};
	const readDecider = readDeciderSetup(deciderPorts);
	const installOllamaBound = installOllama(deciderPorts);
	const useLocal = useLocalDecider(deciderPorts);
	const useTypesafe = useTypesafeDecider(deciderPorts);
	const cancelDecider = cancelDeciderSetup(deciderPorts);
	const stopDeciders = stopDeciderSetups({ job: deciderJob });

	const decider: DeciderSetup = {
		status: (caller) => readDecider(actor, caller),
		installOllama: (caller) => installOllamaBound(actor, caller),
		useLocal: (caller) => useLocal(actor, caller),
		useTypesafe: (key, caller) => useTypesafe(actor, { key, ...caller }),
		cancel: (caller) => cancelDecider(actor, caller),
		stop: () => stopDeciders({}),
	};

	return { agent, decider };
}
