/**
 * Coding agents that speak the Agent Client Protocol (ACP), driven through
 * `acpCompatible` from `@tanstack/ai-acp` and the local-process sandbox in
 * `input.cwd`. An agent is one row of `ACP_AGENTS`: how to start it in ACP
 * mode. Everything else (the session, resume, bridged tools, MCP servers,
 * permission requests, the AG-UI stream) is the adapter's.
 *
 * Each agent runs with the user's own login (`authMode: "host"`). The
 * permission mode becomes the adapter's ACP policy (see `acpPermission`).
 * MCP servers reach the agent over ACP, URL servers only.
 *
 * Verified live: none yet. The launch commands are from each agent's docs.
 */
import { chat } from "@tanstack/ai";
import type { AcpPermissionMode } from "@tanstack/ai-acp";
import { acpCompatible } from "@tanstack/ai-acp";
import { withSandbox } from "@tanstack/ai-sandbox";
import {
	hostSandbox,
	providerTap,
	removeProjectionMarkers,
	runAdapterSession,
	shellQuote,
} from "./adapter-session";
import { reportStepTool, stepReportSetup } from "./step-report";
import {
	createTranslator,
	type HarnessProfile,
	type SdkSignals,
	type Translator,
} from "./translate";
import type {
	AgentEvent,
	AgentHarness,
	AgentSessionInput,
	Effort,
	HarnessName,
	PermissionMode,
} from "./types";

export type AcpAgentName = Extract<
	HarnessName,
	"copilot" | "gemini" | "cursor"
>;

/** The model name that leaves the choice to the agent's own setting. */
export const ACP_DEFAULT_MODEL = "default";

export type AcpAgent = {
	label: string;
	/**
	 * The arguments after the executable that start its ACP server on stdio.
	 * `model` is unset for `ACP_DEFAULT_MODEL`.
	 */
	args: (session: { model?: string; effort?: Effort }) => string[];
};

const modelFlag = (model: string | undefined) =>
	model ? ["--model", model] : [];

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
 * Read the raw ACP events (the adapter's provider log). Some agents report
 * a failure as message text and then end the turn normally (Copilot:
 * "Error: You have exceeded your monthly quota"). That text fails the
 * session, so the engine waits out a usage limit instead of a pass.
 */
export function observeAcpEvent(signals: SdkSignals, raw: unknown): SdkSignals {
	const event = raw as {
		kind?: string;
		update?: { sessionUpdate?: string; content?: { text?: unknown } };
	} | null;
	const text = event?.update?.content?.text;
	if (
		event?.kind !== "update" ||
		event.update?.sessionUpdate !== "agent_message_chunk" ||
		typeof text !== "string" ||
		!text.trimStart().startsWith("Error:")
	) {
		return signals;
	}
	return { ...signals, resultError: text.trim() };
}

function profile(name: AcpAgentName): HarnessProfile {
	return {
		label: ACP_AGENTS[name].label,
		// `acpCompatible` emits `<name>.session-id`.
		sessionEvent: `${name}.session-id`,
		createObserver: () => observeAcpEvent,
	};
}

function startChat(
	name: AcpAgentName,
	input: AgentSessionInput,
	options: AcpHarnessOptions,
	translator: Translator,
	abortController: AbortController,
): AsyncIterable<unknown> {
	// Bridged tools are always allowed, so plan mode reports with the tool too.
	const report = stepReportSetup(
		{ ...input, permissionMode: "default" },
		undefined,
	);
	const host = hostSandbox(input.cwd, input.mcpServers);
	if (typeof host === "string") throw new Error(host);
	const agent = ACP_AGENTS[name];
	const adapter = acpCompatible({
		name,
		command: ({ model }) =>
			[
				shellQuote(options.executable),
				...agent
					.args({
						...(model !== ACP_DEFAULT_MODEL ? { model } : {}),
						...(input.effort ? { effort: input.effort } : {}),
					})
					.map(shellQuote),
			].join(" "),
		authMode: "host",
		permissionMode: acpPermission(input.permissionMode),
		refusalMessage: `${agent.label} refused the request.`,
		...(options.env ? { env: options.env } : {}),
	})(input.model);

	return chat({
		adapter,
		threadId: host.id,
		messages: [{ role: "user", content: report.prompt }],
		...(report.withTool ? { tools: [reportStepTool(input.stepReport)] } : {}),
		...(input.resumeSessionId
			? { modelOptions: { sessionId: input.resumeSessionId } }
			: {}),
		middleware: [withSandbox(host.sandbox)],
		abortController,
		debug: providerTap(translator),
	}) as AsyncIterable<unknown>;
}

/** Run one session of an ACP agent and translate it into AgentEvent values. Never throws. */
export function runAcpSession(
	name: AcpAgentName,
	input: AgentSessionInput,
	options: AcpHarnessOptions,
): AsyncGenerator<AgentEvent> {
	const translator = createTranslator({
		fallbackSessionId: input.resumeSessionId ?? crypto.randomUUID(),
		stepReport: input.stepReport ?? false,
		profile: profile(name),
		...(input.resumeSessionId ? { knownSessionId: input.resumeSessionId } : {}),
	});
	return runAdapterSession({
		signal: input.signal,
		translator,
		start: (abortController) =>
			startChat(name, input, options, translator, abortController),
		...(options.abortGraceMs !== undefined
			? { abortGraceMs: options.abortGraceMs }
			: {}),
		cleanup: () => removeProjectionMarkers(input.cwd),
	});
}

/** Runs sessions of one ACP agent on this computer, in `input.cwd`, with the user's own login. */
export function acpHarness(
	name: AcpAgentName,
	options: AcpHarnessOptions,
): AgentHarness {
	return { name, run: (input) => runAcpSession(name, input, options) };
}
