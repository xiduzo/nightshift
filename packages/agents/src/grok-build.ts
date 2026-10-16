/**
 * The Grok Build harness: one `grok -p … --output-format streaming-json` per
 * session, driven through `@tanstack/ai-grok-build` and the local-process
 * sandbox in `input.cwd`, with the user's `grok login`.
 *
 * The permission mode becomes a TanStack `SandboxPolicy`, which the adapter
 * maps onto grok's own flags (see `grokPolicy`). The node's MCP servers go
 * through `.grok/config.toml` in the worktree; the harness removes that
 * folder afterwards when the session created it.
 *
 * `streaming-json` has no tool-call events (grok narrates tool use in its
 * thoughts), so a `report_step` call would be invisible. The agent reports
 * with a `NIGHTSHIFT-REPORT:` line in its final text instead (see
 * `observeGrokEvent`). Grok's ACP mode has tool events, but it always
 * approves every action, so it cannot keep a permission mode.
 *
 * Unverified: the `grok` CLI was not installed when this was written.
 */
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { chat } from "@tanstack/ai";
import { GROK_BUILD_MODELS, grokBuildText } from "@tanstack/ai-grok-build";
import { type SandboxPolicy, withSandbox } from "@tanstack/ai-sandbox";
import {
	hostSandbox,
	providerTap,
	removeProjectionMarkers,
	runAdapterSession,
	shellQuote,
} from "./adapter-session";
import { stepReportSetup } from "./step-report";
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
	PermissionMode,
} from "./types";

export { GROK_BUILD_MODELS };

export type GrokBuildHarnessOptions = {
	/** Path or name of the `grok` executable. Defaults to `grok`. */
	grokExecutable?: string;
	/** Extra environment variables for the `grok` process. */
	env?: Record<string, string>;
	/** How long to wait for the process to stop after an abort. Default 5 s. */
	abortGraceMs?: number;
};

/**
 * The sandbox policy for a permission mode. Without one, grok approves
 * every action (`--always-approve`).
 *
 * - `bypassPermissions`, `auto`: no policy.
 * - `acceptEdits`: grok's own default permission mode, edits allowed.
 * - `default`, `plan`: that mode in a read-only sandbox.
 */
export function grokPolicy(mode: PermissionMode): SandboxPolicy | undefined {
	switch (mode) {
		case "bypassPermissions":
		case "auto":
			return undefined;
		case "acceptEdits":
			return { default: "deny", capabilities: { fileWrite: "allow" } };
		default:
			return { default: "deny", capabilities: { fileWrite: "deny" } };
	}
}

/**
 * Read grok's raw `streaming-json` events: the answer text (for the text
 * report) and an `error` event's message (a usage limit or a network
 * error makes the engine wait).
 */
export function observeGrokEvent(
	signals: SdkSignals,
	raw: unknown,
): SdkSignals {
	const event = raw as { type?: unknown; data?: unknown; message?: unknown };
	if (event?.type === "text" && typeof event.data === "string") {
		return { ...signals, resultText: (signals.resultText ?? "") + event.data };
	}
	if (event?.type === "error" && typeof event.message === "string") {
		return { ...signals, resultError: event.message };
	}
	return signals;
}

export const GROK_BUILD_PROFILE: HarnessProfile = {
	label: "Grok Build",
	sessionEvent: "grok-build.session-id",
	createObserver: () => observeGrokEvent,
};

function startChat(
	input: AgentSessionInput,
	options: GrokBuildHarnessOptions,
	translator: Translator,
	abortController: AbortController,
): AsyncIterable<unknown> {
	// The text report, as in plan mode: see the module comment.
	const report = stepReportSetup(
		{ ...input, permissionMode: "plan" },
		undefined,
	);
	const host = hostSandbox(
		input.cwd,
		input.mcpServers,
		grokPolicy(input.permissionMode),
	);
	if (typeof host === "string") throw new Error(host);

	return chat({
		adapter: grokBuildText(input.model, {
			// The adapter runs the executable through `sh -c`.
			grokExecutable: shellQuote(options.grokExecutable ?? "grok"),
			// `streaming-json` honours the policy; `acp` always approves.
			protocol: "streaming-json",
			authMode: "host",
			emitDiff: false,
			...(options.env ? { env: options.env } : {}),
		}),
		threadId: host.id,
		messages: [{ role: "user", content: report.prompt }],
		...(input.resumeSessionId
			? { modelOptions: { sessionId: input.resumeSessionId } }
			: {}),
		middleware: [withSandbox(host.sandbox)],
		abortController,
		debug: providerTap(translator),
	}) as AsyncIterable<unknown>;
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}

/** Run one Grok Build session and translate it into AgentEvent values. Never throws. */
export async function* runGrokBuildSession(
	input: AgentSessionInput,
	options: GrokBuildHarnessOptions = {},
): AsyncGenerator<AgentEvent> {
	const grokDir = join(input.cwd, ".grok");
	const hadGrokDir = await exists(grokDir);
	const translator = createTranslator({
		fallbackSessionId: input.resumeSessionId ?? crypto.randomUUID(),
		stepReport: input.stepReport ?? false,
		profile: GROK_BUILD_PROFILE,
		...(input.resumeSessionId ? { knownSessionId: input.resumeSessionId } : {}),
	});
	yield* runAdapterSession({
		signal: input.signal,
		translator,
		start: (abortController) =>
			startChat(input, options, translator, abortController),
		...(options.abortGraceMs !== undefined
			? { abortGraceMs: options.abortGraceMs }
			: {}),
		cleanup: async () => {
			await removeProjectionMarkers(input.cwd);
			// The adapter's MCP config: keep a project's own, drop ours.
			if (!hadGrokDir) await rm(grokDir, { recursive: true, force: true });
		},
	});
}

/** Runs Grok Build sessions on this computer, in `input.cwd`, with the user's `grok login`. */
export function grokBuildHarness(
	options: GrokBuildHarnessOptions = {},
): AgentHarness {
	return {
		name: "grok-build",
		run: (input) => runGrokBuildSession(input, options),
	};
}
