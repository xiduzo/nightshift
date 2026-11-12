import {
	type AgentHarness,
	acpHarness,
	checkCli,
	checkCustomAgent,
	checkHarness,
	claudeCodeHarness,
	codexHarness,
	customAcpHarness,
	grokBuildHarness,
	type HarnessName,
	harnessFacts,
	harnessModels,
	opencodeHarness,
	pathPrograms,
	testMcpServer,
} from "@nightshift/agents";
import { findProgram } from "@nightshift/agents/types";
import type { Context } from "@nightshift/api/context";
import type { Harnesses } from "@nightshift/engine";
import {
	type ConnectionStore,
	HARNESS_BIN,
	type SecretUse,
	type SettingsStore,
	unreachableNote,
} from "@nightshift/engine/device-config";
import {
	type AgentHarnessName,
	type CustomHarnessName,
	isCustomHarness,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

/** A harness built per session, so a changed path in Settings applies to the next session. */
function perSession(
	name: HarnessName,
	build: () => AgentHarness,
): AgentHarness {
	return { name, ...harnessFacts(name), run: (input) => build().run(input) };
}

/**
 * The harnesses of this computer's Device: one per harness Night Shift
 * knows, and the custom agents of the settings. A harness counts once it
 * is added on the Agents page: built here is not enough. Each one spawns
 * its CLI only when an Agent node names it. The settings are read at each
 * question, so an edit applies to the next session.
 */
export function localHarnesses(deps: {
	settings: Pick<SettingsStore, "current">;
	connections: Pick<ConnectionStore, "expandEnv">;
	/**
	 * How the pi harness starts pi-acp. The `nightshift` binary runs itself
	 * (`nightshift pi-acp`). Undefined: pi-acp's own script, from source.
	 */
	piAcp?: string[];
}): Harnesses {
	const { settings, connections, piAcp } = deps;
	const built = {
		"claude-code": perSession("claude-code", () =>
			claudeCodeHarness({
				claudeExecutable: settings.current().claudeBin,
			}),
		),
		opencode: perSession("opencode", () =>
			opencodeHarness({
				opencodeExecutable: settings.current().opencodeBin,
			}),
		),
		codex: perSession("codex", () =>
			codexHarness({
				codexExecutable: settings.current().codexBin,
			}),
		),
		"grok-build": perSession("grok-build", () =>
			grokBuildHarness({ grokExecutable: settings.current().grokBin }),
		),
		copilot: perSession("copilot", () =>
			acpHarness("copilot", { executable: settings.current().copilotBin }),
		),
		gemini: perSession("gemini", () =>
			acpHarness("gemini", { executable: settings.current().geminiBin }),
		),
		cursor: perSession("cursor", () =>
			acpHarness("cursor", { executable: settings.current().cursorBin }),
		),
		pi: perSession("pi", () =>
			acpHarness("pi", {
				executable: settings.current().piBin,
				...(piAcp ? { piAcp } : {}),
			}),
		),
	} satisfies Record<HarnessName, AgentHarness>;

	// Custom agents: read from the settings at each session, so an edit
	// applies to the next one. `${NAME}` in their env reads the secrets,
	// then this computer's environment: once per session, and every value
	// it reads comes back as `•••` in the session's output.
	// `use` says where the session happens: the Secret scope rule reads it.
	const customAgent = (
		name: CustomHarnessName,
		use?: SecretUse,
	): AgentHarness | undefined => {
		const agent = settings
			.current()
			.customAgents.find((a) => `acp:${a.slug}` === name);
		if (!agent) return undefined;
		let expanding: ReturnType<ConnectionStore["expandEnv"]> | null = null;
		const expanded = () => {
			expanding ??= connections.expandEnv(agent.env, use);
			return expanding;
		};
		const harness = customAcpHarness(agent, {
			env: async () => {
				const env = await expanded();
				if (env.ok) return env.env;
				const [noun, isNot, it] =
					env.missing.length === 1
						? ["secret", "it is", "it"]
						: ["secrets", "they are", "them"];
				// Words for the person: the step shows them as they are.
				throw new Refusal(
					"conflict",
					`${agent.label} needs the ${noun} ${env.missing.join(", ")}, but ${isNot} not saved. Save ${it} on the Secrets page, or remove the reference.${unreachableNote(env)}`,
				);
			},
		});
		return {
			...harness,
			secretValues: async () => {
				const env = await expanded();
				return env.ok ? env.values : [];
			},
		};
	};

	return {
		get: (name, use) => {
			if (isCustomHarness(name)) return customAgent(name, use);
			return settings.current().harnesses.includes(name)
				? built[name]
				: undefined;
		},
		names: () => {
			const { harnesses, customAgents } = settings.current();
			return [
				...(Object.keys(built) as HarnessName[]).filter((name) =>
					harnesses.includes(name),
				),
				...customAgents.map((a) => `acp:${a.slug}` as const),
			];
		},
	};
}

/**
 * The harnesses of `localHarnesses` by name, as a session outside a run
 * (the assistant) finds them: a harness that is added, and whether its
 * program is on this computer.
 */
export function harnessLookup(
	harnesses: Harnesses,
	settings: Pick<SettingsStore, "current">,
	which: (program: string) => string | null = (program) => findProgram(program),
): {
	harnessFor: (name: AgentHarnessName) => AgentHarness | undefined;
	installed: (name: AgentHarnessName) => boolean;
} {
	return {
		// No `use`: the session is not a run's, so a custom agent's
		// `${NAME}` reads no Space or Project secret (`SecretUse.run`).
		harnessFor: (name) => harnesses.get(name),
		installed: (name) => {
			if (isCustomHarness(name)) {
				const agent = settings
					.current()
					.customAgents.find((a) => `acp:${a.slug}` === name);
				return agent !== undefined && which(agent.command) !== null;
			}
			return which(String(settings.current()[HARNESS_BIN[name]])) !== null;
		},
	};
}

/** The checks of this computer's programs: harness CLIs, custom agents, CLI tools, MCP servers. */
export function programChecks(): Context["checks"] {
	return {
		harness: checkHarness,
		customAgent: checkCustomAgent,
		cli: (name) => checkCli(name),
		programs: () => pathPrograms(),
		mcp: (config, redact) => testMcpServer(config, { redact }),
		models: harnessModels,
	};
}
