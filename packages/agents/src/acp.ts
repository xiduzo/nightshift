/**
 * Coding agents that speak the Agent Client Protocol (ACP), driven through
 * `acpCompatible` from `@tanstack/ai-acp` on the shared harness session
 * (`adapter-session.ts`). An agent is one row of `ACP_AGENTS`: how to start it in ACP
 * mode. Everything else (the session, resume, bridged tools, MCP servers,
 * permission requests, the AG-UI stream) is the adapter's.
 *
 * Each agent runs with the user's own login (`authMode: "host"`). The
 * permission mode becomes the adapter's ACP policy (see `acpPermission`).
 * MCP servers reach the agent over ACP, URL servers only.
 *
 * An agent takes its model as a flag, or over ACP once the session is open
 * (`model: "session"`, see `acp-session-config.ts`).
 *
 * Verified live: pi 1.3 through pi-acp 0.0.34, with an Ollama model. The
 * other launch commands are from each agent's docs.
 */
import { fileURLToPath } from "node:url";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import type { AcpPermissionMode } from "@tanstack/ai-acp";
import { acpCompatible, spawnHandleToAcpTransport } from "@tanstack/ai-acp";
import { type SessionConfig, withSessionConfig } from "./acp-session-config";
import {
	type AdapterSetup,
	type HarnessSpec,
	harnessSession,
	shellQuote,
} from "./adapter-session";
import { harnessFacts } from "./harness-facts";
import type { SdkSignals } from "./translate";
import type {
	AgentHarness,
	AgentSessionInput,
	Effort,
	HarnessName,
	PermissionMode,
} from "./types";

export type AcpAgentName = Extract<
	HarnessName,
	"copilot" | "gemini" | "cursor" | "pi"
>;

/** The model name that leaves the choice to the agent's own setting. */
export const ACP_DEFAULT_MODEL = "default";

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
	 * runs `pi --mode rpc` and speaks ACP for it.
	 */
	launch?: (executable: string) => {
		argv: string[];
		env: Record<string, string>;
	};
};

const modelFlag = (model: string | undefined) =>
	model ? ["--model", model] : [];

/** pi-acp's entry point, run with this process's runtime (Bun). */
const PI_ACP = fileURLToPath(import.meta.resolve("pi-acp"));

/** The ACP agents Night Shift offers as harnesses. */
export const ACP_AGENTS: Record<AcpAgentName, AcpAgent> = {
	// docs.github.com/copilot/reference/acp-server
	copilot: {
		label: "GitHub Copilot",
		args: ({ model, effort }) => [
			"--acp",
			"--stdio",
			...modelFlag(model),
			...(effort ? ["--effort", effort] : []),
		],
	},
	// github.com/google-gemini/gemini-cli docs/cli/acp-mode.md
	gemini: {
		label: "Gemini CLI",
		args: ({ model }) => ["--acp", ...modelFlag(model)],
	},
	// cursor.com/docs/cli/acp
	cursor: {
		label: "Cursor",
		args: ({ model }) => [...modelFlag(model), "acp"],
	},
	// github.com/svkozak/pi-acp: `PI_ACP_PI_COMMAND` is the pi it runs.
	pi: {
		label: "pi",
		args: () => [],
		model: "session",
		mcp: false,
		launch: (pi) => ({
			argv: [process.execPath, PI_ACP],
			env: { PI_ACP_PI_COMMAND: pi },
		}),
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
	/** Extra environment variables for the agent process. */
	env?: Record<string, string>;
	/** How long to wait for the process to stop after an abort. Default 5 s. */
	abortGraceMs?: number;
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

/** The adapter of one ACP agent session. */
function acpAdapter(
	name: string,
	agent: AcpAgent,
	input: AgentSessionInput,
	options: AcpHarnessOptions,
): AdapterSetup {
	const servers = Object.keys(input.mcpServers ?? {});
	if (agent.mcp === false && servers.length > 0) {
		throw new Error(
			`${agent.label} cannot use connections yet. Remove ${servers.join(", ")} from the node, or run it on another harness.`,
		);
	}
	const model = input.model !== ACP_DEFAULT_MODEL ? input.model : undefined;
	const bySession = agent.model === "session";
	const launch = agent.launch?.(options.executable) ?? {
		argv: [options.executable],
		env: {},
	};
	const env = { ...launch.env, ...options.env };
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
		.map(shellQuote)
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
	return { adapter };
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
		run: (input) =>
			harnessSession({
				input,
				spec: acpSpec(name, agent),
				adapter: () => acpAdapter(name, agent, input, options),
				...(options.abortGraceMs !== undefined
					? { abortGraceMs: options.abortGraceMs }
					: {}),
			}),
	};
}
