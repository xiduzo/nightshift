/**
 * Coding agents that speak the Agent Client Protocol (ACP), driven through
 * `acpCompatible` from `@tanstack/ai-acp` on the shared harness session
 * (`session/adapter-session.ts`). An agent is one row of `ACP_AGENTS`: how to start it in ACP
 * mode. Everything else (the session, resume, bridged tools, MCP servers,
 * permission requests, the AG-UI stream) is the adapter's.
 *
 * Each agent runs with the user's own login (`authMode: "host"`). The
 * permission mode becomes the adapter's ACP policy (see `acpPermission`).
 * MCP servers reach the agent over ACP, URL servers only.
 *
 * An agent takes its model as a flag, or over ACP once the session is open
 * (`model: "session"`, see `session-config.ts`).
 *
 * Verified live: pi 1.3 through pi-acp 0.0.34, with an Ollama model. The
 * other launch commands are from each agent's docs.
 */
import { type CustomAgent, customHarnessName } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { AcpPermissionMode } from "@tanstack/ai-acp";
import {
	type AgentHarness,
	type AgentSessionInput,
	type Effort,
	type HarnessName,
	type PermissionMode,
	shellQuoteAlways,
} from "../../port";
import {
	type AdapterSetup,
	type HarnessSpec,
	harnessSession,
	readOnlyInput,
	type SdkSignals,
} from "../../session";
import { harnessFacts } from "../facts";
import { ACP_DEFAULT_MODEL, ACP_FACTS, type AcpAgentName } from "./facts";
import { piAcpCommand, piReadOnly } from "./pi";
import { type SessionConfig, withSessionConfig } from "./session-config";

export type AcpAgent = {
	label: string;
	/**
	 * The arguments after the executable that start its ACP server on stdio.
	 * `model` is unset for `ACP_DEFAULT_MODEL`, and for an agent that takes
	 * the model over ACP.
	 */
	args: (session: { model?: string; effort?: Effort }) => string[];
	/**
	 * How the agent takes the model and the effort. `flag` (the default):
	 * `args` carries them. `session`: Night Shift chooses them over ACP
	 * before the first prompt, from the config options the agent offers.
	 */
	model?: "flag" | "session";
	/**
	 * False: the agent drops the MCP servers it gets over ACP (pi-acp), so
	 * it cannot call the bridged `report_step` tool. It reports a step with
	 * a text line, and a node with connections cannot run on it.
	 */
	mcp?: boolean;
	/**
	 * Start it through another program, given the configured executable.
	 * pi has no ACP mode of its own: pi-acp (a dependency of this package)
	 * runs `pi --mode rpc` and speaks ACP for it. Called when a session
	 * starts. A throw ends the session with its message.
	 */
	launch?: (
		executable: string,
		options?: Pick<AcpHarnessOptions, "piAcp">,
	) => {
		argv: string[];
		env: Record<string, string>;
	};
	/**
	 * How a read-only session starts it, for an agent that asks no
	 * permission before it writes (pi): the executable to run instead of the
	 * configured one, and what removes it afterwards. Without it, a
	 * read-only session relies on the agent asking, and the adapter refusing.
	 */
	readOnly?: (
		executable: string,
	) => Promise<{ executable: string; cleanup: () => Promise<void> }>;
};

const modelFlag = (model: string | undefined) =>
	model ? ["--model", model] : [];

/** The ACP agents Night Shift offers as harnesses. */
export const ACP_AGENTS: Record<AcpAgentName, AcpAgent> = {
	// docs.github.com/copilot/reference/acp-server
	copilot: {
		label: ACP_FACTS.copilot.label,
		args: ({ model, effort }) => [
			"--acp",
			"--stdio",
			...modelFlag(model),
			...(effort ? ["--effort", effort] : []),
		],
	},
	// github.com/google-gemini/gemini-cli docs/cli/acp-mode.md
	gemini: {
		label: ACP_FACTS.gemini.label,
		args: ({ model }) => ["--acp", ...modelFlag(model)],
	},
	// cursor.com/docs/cli/acp
	cursor: {
		label: ACP_FACTS.cursor.label,
		args: ({ model }) => [...modelFlag(model), "acp"],
	},
	// github.com/svkozak/pi-acp: `PI_ACP_PI_COMMAND` is the pi it runs.
	pi: {
		label: ACP_FACTS.pi.label,
		args: () => [],
		model: "session",
		mcp: false,
		launch: (pi, options) => ({
			argv: options?.piAcp ?? piAcpCommand(),
			env: { PI_ACP_PI_COMMAND: pi },
		}),
		readOnly: piReadOnly,
	},
};

export const isAcpAgent = (name: HarnessName): name is AcpAgentName =>
	Object.hasOwn(ACP_AGENTS, name);

/**
 * The adapter's ACP policy for a permission mode. Night Shift's own tools
 * (`report_step`) are always allowed. Refused requests end as tool errors.
 *
 * - `bypassPermissions`, `auto`: every request is allowed.
 * - `acceptEdits`: edits, moves and deletes are allowed.
 * - `default`, `plan`: every request is refused.
 */
export function acpPermission(mode: PermissionMode): AcpPermissionMode {
	switch (mode) {
		case "bypassPermissions":
		case "auto":
			return "bypassPermissions";
		case "acceptEdits":
			return "acceptEdits";
		default:
			return "default";
	}
}

export type AcpHarnessOptions = {
	/** Path or name of the agent's executable. */
	executable: string;
	/**
	 * Extra environment variables for the agent process. A function is
	 * called for each session (a custom agent reads its secrets then); a
	 * throw ends the session with its message.
	 */
	env?: Record<string, string> | (() => Promise<Record<string, string>>);
	/** How long to wait for the process to stop after an abort. Default 5 s. */
	abortGraceMs?: number;
	/**
	 * pi only: the command that starts pi-acp. Default `piAcpCommand()`. A
	 * build that carries pi-acp inside gives the command that starts it
	 * there (`runPiAcp`).
	 */
	piAcp?: string[];
};

/**
 * Read the raw ACP events (the adapter's provider log).
 *
 * - Some agents report a failure as message text and then end the turn
 *   normally (Copilot: "Error: You have exceeded your monthly quota"). That
 *   text fails the session, so the engine waits out a usage limit instead
 *   of a pass.
 * - A `usage_update` with a cost in US dollars is what the session has
 *   spent so far. The last one is also its cost at the end: the prompt
 *   response has tokens but no cost.
 */
export function observeAcpEvent(signals: SdkSignals, raw: unknown): SdkSignals {
	const event = raw as {
		kind?: string;
		update?: {
			sessionUpdate?: string;
			content?: { text?: unknown };
			cost?: { amount?: unknown; currency?: unknown } | null;
		};
	} | null;
	if (event?.kind !== "update") return signals;
	const update = event.update;
	if (update?.sessionUpdate === "usage_update") {
		const amount = update.cost?.amount;
		if (
			update.cost?.currency !== "USD" ||
			typeof amount !== "number" ||
			!Number.isFinite(amount)
		) {
			return signals;
		}
		const usage = { inputTokens: 0, outputTokens: 0, costUsd: amount };
		return { ...signals, liveUsage: usage, resultUsage: usage };
	}
	const text = messageText(raw);
	if (text === undefined || !text.trimStart().startsWith("Error:")) {
		return signals;
	}
	return { ...signals, resultError: text.trim() };
}

/** The text of an `agent_message_chunk` event, else undefined. */
function messageText(raw: unknown): string | undefined {
	const event = raw as {
		kind?: string;
		update?: { sessionUpdate?: string; content?: { text?: unknown } };
	} | null;
	const text = event?.update?.content?.text;
	return event?.kind === "update" &&
		event.update?.sessionUpdate === "agent_message_chunk" &&
		typeof text === "string"
		? text
		: undefined;
}

/**
 * `observeAcpEvent`, and the agent's text kept as the result text: an agent
 * without MCP reports its step in a text line (`parseTextReport`).
 */
export function observeAcpTextEvent(
	signals: SdkSignals,
	raw: unknown,
): SdkSignals {
	const next = observeAcpEvent(signals, raw);
	const text = messageText(raw);
	return text === undefined
		? next
		: { ...next, resultText: (next.resultText ?? "") + text };
}

/**
 * The session knobs of one ACP agent. Bridged tools are always allowed, so
 * plan mode reports with the tool too. MCP servers reach the agent over ACP
 * as workspace skills. A resumed session may not announce itself again. An
 * agent without MCP reports in text.
 */
export function acpSpec(name: string, agent: AcpAgent): HarnessSpec {
	const mcp = agent.mcp !== false;
	return {
		profile: {
			label: agent.label,
			// `acpCompatible` emits `<name>.session-id`.
			sessionEvent: `${name}.session-id`,
			createObserver: () => (mcp ? observeAcpEvent : observeAcpTextEvent),
		},
		report: mcp ? "tool" : "text",
		mcpAsSkills: mcp,
		resumeIsSilent: true,
	};
}

/**
 * The adapter of one ACP agent session. The adapter packages load on the
 * first session, not when Night Shift starts.
 */
async function acpAdapter(
	name: string,
	agent: AcpAgent,
	input: AgentSessionInput,
	options: AcpHarnessOptions,
): Promise<AdapterSetup> {
	const [{ ndJsonStream }, { acpCompatible, spawnHandleToAcpTransport }] =
		await Promise.all([
			import("@agentclientprotocol/sdk"),
			import("@tanstack/ai-acp"),
		]);
	const servers = Object.keys(input.mcpServers ?? {});
	if (agent.mcp === false && servers.length > 0) {
		throw new Refusal(
			"invalid",
			`${agent.label} cannot use connections yet. Remove ${servers.join(", ")} from the node, or run it on another harness.`,
		);
	}
	const model = input.model !== ACP_DEFAULT_MODEL ? input.model : undefined;
	const bySession = agent.model === "session";
	const ownEnv =
		typeof options.env === "function" ? await options.env() : options.env;
	// A read-only session of an agent that never asks starts a copy of it
	// with its read tools only.
	const readOnly =
		input.readOnly && agent.readOnly
			? await agent.readOnly(options.executable)
			: undefined;
	const executable = readOnly?.executable ?? options.executable;
	let launch: { argv: string[]; env: Record<string, string> };
	try {
		launch = agent.launch?.(executable, options) ?? {
			argv: [executable],
			env: {},
		};
	} catch (error) {
		await readOnly?.cleanup();
		throw error;
	}
	const env = { ...launch.env, ...ownEnv };
	const command = [
		...launch.argv,
		...agent.args(
			bySession
				? {}
				: {
						...(model ? { model } : {}),
						...(input.effort ? { effort: input.effort } : {}),
					},
		),
	]
		.map(shellQuoteAlways)
		.join(" ");
	const config: SessionConfig = bySession
		? {
				...(model ? { model } : {}),
				...(input.effort ? { effort: input.effort } : {}),
			}
		: {};
	const adapter = acpCompatible({
		name,
		...(config.model || config.effort
			? {
					// The stdio transport `command` would open, with the
					// model and effort chosen over ACP on the way.
					openTransport: async (ctx) => {
						const bytes = spawnHandleToAcpTransport(
							await ctx.sandbox.process.spawn(command, {
								cwd: ctx.cwd,
								...(ctx.env ? { env: ctx.env } : {}),
								...(ctx.signal ? { signal: ctx.signal } : {}),
							}),
						);
						return {
							kind: "stream" as const,
							stream: withSessionConfig(
								ndJsonStream(bytes.writable, bytes.readable),
								config,
								agent.label,
							),
							dispose: bytes.kill,
							stderrTail: bytes.stderrTail,
						};
					},
				}
			: { command: () => command }),
		authMode: "host",
		permissionMode: acpPermission(input.permissionMode),
		refusalMessage: `${agent.label} refused the request.`,
		...(Object.keys(env).length > 0 ? { env } : {}),
	})(input.model);
	return { adapter, ...(readOnly ? { cleanup: readOnly.cleanup } : {}) };
}

/** Runs sessions of one ACP agent on this computer, in `input.cwd`, with the user's own login. */
export function acpHarness(
	name: AcpAgentName,
	options: AcpHarnessOptions,
): AgentHarness {
	return {
		...acpAgentHarness(name, ACP_AGENTS[name], options),
		...harnessFacts(name),
	};
}

/**
 * Runs sessions of any ACP agent described by `agent`. Its label is the
 * agent's; it has no take-over command.
 */
export function acpAgentHarness(
	name: AgentHarness["name"],
	agent: AcpAgent,
	options: AcpHarnessOptions,
): AgentHarness {
	return {
		name,
		label: agent.label,
		takeOverCommand: () => null,
		run: (raw) => {
			const input = readOnlyInput(raw);
			return harnessSession({
				input,
				spec: acpSpec(name, agent),
				adapter: () => acpAdapter(name, agent, input, options),
				...(options.abortGraceMs !== undefined
					? { abortGraceMs: options.abortGraceMs }
					: {}),
			});
		},
	};
}

/**
 * Runs sessions of a custom agent: one the person added with its command.
 * It takes the model over ACP, never as a flag: `default` leaves the
 * agent's own setting.
 */
export function customAcpHarness(
	agent: Pick<CustomAgent, "slug" | "label" | "command" | "args">,
	options: Omit<AcpHarnessOptions, "executable"> = {},
): AgentHarness {
	return acpAgentHarness(
		customHarnessName(agent.slug),
		{ label: agent.label, args: () => [...agent.args], model: "session" },
		{ ...options, executable: agent.command },
	);
}
