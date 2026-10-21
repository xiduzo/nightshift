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
import type { Context } from "@nightshift/api/context";
import type {
	ConnectionStore,
	localDevice,
	SettingsStore,
} from "@nightshift/engine";

type LocalDeviceOptions = Parameters<typeof localDevice>[0];

/** A harness built per session, so a changed path in Settings applies to the next session. */
function perSession(
	name: HarnessName,
	build: () => AgentHarness,
): AgentHarness {
	return { name, ...harnessFacts(name), run: (input) => build().run(input) };
}

/**
 * The harnesses of this computer's Device: one per harness Night Shift
 * knows, and the custom agents of the settings. Each harness spawns its CLI
 * only when an Agent node names it.
 */
export function localHarnesses(deps: {
	settings: Pick<SettingsStore, "current">;
	connections: Pick<ConnectionStore, "expandEnv">;
	/**
	 * How the pi harness starts pi-acp. The `nightshift` binary runs itself
	 * (`nightshift pi-acp`). Undefined: pi-acp's own script, from source.
	 */
	piAcp?: string[];
}): Pick<
	LocalDeviceOptions,
	"harnesses" | "customHarness" | "customHarnessNames" | "harnessNames"
> {
	const { settings, connections, piAcp } = deps;
	return {
		harnesses: {
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
		},
		// Custom agents: read from the settings at each session, so an edit
		// applies to the next one. `${NAME}` in their env reads the secrets.
		customHarness: (name) => {
			const agent = settings
				.current()
				.customAgents.find((a) => `acp:${a.slug}` === name);
			if (!agent) return undefined;
			return customAcpHarness(agent, {
				env: async () => {
					const expanded = await connections.expandEnv(agent.env);
					if (expanded.ok) return expanded.env;
					const [noun, isNot, it] =
						expanded.missing.length === 1
							? ["secret", "it is", "it"]
							: ["secrets", "they are", "them"];
					throw new Error(
						`${agent.label} needs the ${noun} ${expanded.missing.join(", ")}, but ${isNot} not saved. Save ${it} under Agents → Secrets, or remove the reference.`,
					);
				},
			});
		},
		customHarnessNames: () =>
			settings.current().customAgents.map((a) => `acp:${a.slug}` as const),
		harnessNames: () => new Set(settings.current().harnesses),
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
