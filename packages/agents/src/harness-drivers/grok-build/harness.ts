/**
 * The Grok Build harness: one `grok -p … --output-format streaming-json` per
 * session, driven through `@tanstack/ai-grok-build` on the shared harness
 * session (`session/adapter-session.ts`), with the user's `grok login`.
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
import type { SandboxPolicy } from "@tanstack/ai-sandbox";
import type {
	AgentHarness,
	AgentSessionInput,
	PermissionMode,
} from "../../port";
import { shellQuoteAlways } from "../../port";
import type { HarnessProfile, SdkSignals } from "../../session";
import {
	type AdapterSetup,
	type HarnessSpec,
	harnessSession,
	readOnlyInput,
} from "../../session";
import { harnessFacts } from "../facts";

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

/**
 * Grok Build's session knobs. The report is always text (see the module
 * comment). MCP servers reach grok as workspace skills. A resumed session
 * may not announce itself again. The adapter has no effort level.
 */
export const GROK_BUILD_SPEC: HarnessSpec = {
	profile: GROK_BUILD_PROFILE,
	report: "text",
	mcpAsSkills: true,
	resumeIsSilent: true,
};

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}

/**
 * The `grok` adapter of one session, with the sandbox policy of its
 * permission mode. The adapter writes its MCP config to `.grok/` in the
 * worktree: keep a project's own, drop ours afterwards.
 */
async function grokBuildAdapter(
	input: AgentSessionInput,
	options: GrokBuildHarnessOptions,
): Promise<AdapterSetup> {
	// The adapter package loads on the first session, not when Night Shift starts.
	const { grokBuildText } = await import("@tanstack/ai-grok-build");
	const grokDir = join(input.cwd, ".grok");
	const hadGrokDir = await exists(grokDir);
	const policy = grokPolicy(input.permissionMode);
	const adapter = grokBuildText(input.model, {
		// The adapter runs the executable through `sh -c`.
		grokExecutable: shellQuoteAlways(options.grokExecutable ?? "grok"),
		// `streaming-json` honours the policy; `acp` always approves.
		protocol: "streaming-json",
		authMode: "host",
		emitDiff: false,
		...(options.env ? { env: options.env } : {}),
	});
	return {
		adapter,
		...(policy ? { policy } : {}),
		cleanup: async () => {
			if (!hadGrokDir) await rm(grokDir, { recursive: true, force: true });
		},
	};
}

/** Runs Grok Build sessions on this computer, in `input.cwd`, with the user's `grok login`. */
export function grokBuildHarness(
	options: GrokBuildHarnessOptions = {},
): AgentHarness {
	return {
		name: "grok-build",
		...harnessFacts("grok-build"),
		run: (raw) => {
			const input = readOnlyInput(raw);
			return harnessSession({
				input,
				spec: GROK_BUILD_SPEC,
				adapter: () => grokBuildAdapter(input, options),
				...(options.abortGraceMs !== undefined
					? { abortGraceMs: options.abortGraceMs }
					: {}),
			});
		},
	};
}
