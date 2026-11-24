/**
 * OpenCode 2.x: driven over ACP (`opencode acp`), not through
 * `@tanstack/ai-opencode`.
 *
 * OpenCode 2.x replaced the 1.x server API that `@tanstack/ai-opencode`
 * (through `@opencode-ai/sdk` 1.x) speaks: `opencode serve` prints
 * `server listening on …` instead of `opencode server listening on …`,
 * serves its API under `/api/…` behind a generated password, and answers
 * the 1.x routes (`/session`, `/event`) with its web app. `opencode acp`
 * starts a private server of its own and speaks ACP on stdio, so the
 * shared ACP harness (`../acp`) runs it.
 *
 * Three things differ from the other ACP agents:
 * - OpenCode 2.x asks no permission by default: it edits and runs commands
 *   without a request. The permission rules of the mode go into
 *   `OPENCODE_CONFIG_CONTENT`, in the 2.x shape (`opencodeRules`).
 * - It runs MCP tools inside its own `execute` tool ("Code Mode"), so the
 *   stream never names `report_step`. The `execute` result lists the calls
 *   it made (`opencodeNestedToolCalls`). The `execute` permission must be
 *   allowed, or every MCP tool is out of reach.
 * - It takes the model over ACP, as a session config option.
 */
import { isRecord } from "@nightshift/flows";
import type { BRIDGED_MCP_SERVER_NAME as ADAPTER_BRIDGE_NAME } from "@tanstack/ai-acp";
import { firstLine, probe, resolveBin } from "../../doctor";
import type { AcpAgent } from "../acp";

/** The adapter's MCP server for the bridged tools. */
const BRIDGED_MCP_SERVER_NAME: typeof ADAPTER_BRIDGE_NAME = "tanstack";

type Action = "allow" | "deny";

/** One OpenCode 2.x permission rule. The last rule that matches wins. */
export type OpencodeRule = {
	action: string;
	resource: string;
	effect: Action;
};

/** The 1.x permissions that 2.x renamed (OpenCode's own config migration). */
const RENAMED: Record<string, string> = {
	bash: "shell",
	task: "subagent",
	write: "edit",
	patch: "edit",
};

/**
 * The 1.x permission rules (`opencodePermission`) as 2.x rules, in the same
 * order, with Code Mode's `execute` allowed: each MCP tool inside it still
 * passes its own rule (`<server>_<tool>`), each command its `shell` rule.
 */
export function opencodeRules(
	permission: Record<string, Action | Record<string, Action>>,
): OpencodeRule[] {
	const rules = Object.entries(permission).flatMap(([key, rule]) => {
		const action = RENAMED[key] ?? key;
		return typeof rule === "string"
			? [{ action, resource: "*", effect: rule }]
			: Object.entries(rule).map(([resource, effect]) => ({
					action,
					resource,
					effect,
				}));
	});
	return [...rules, { action: "execute", resource: "*", effect: "allow" }];
}

/**
 * The bridged tools an `execute` result says it called:
 * `{"metadata":{"toolCalls":[{"tool":"tanstack.report_step","status":"completed","input":{…}}]}}`.
 * Other results give none.
 */
export function opencodeNestedToolCalls(
	content: unknown,
): { name: string; input: unknown; failed: boolean }[] {
	let value = content;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return [];
		}
	}
	const metadata = isRecord(value) ? value.metadata : undefined;
	const calls = isRecord(metadata) ? metadata.toolCalls : undefined;
	if (!Array.isArray(calls)) return [];
	const prefix = `${BRIDGED_MCP_SERVER_NAME}.`;
	return calls.flatMap((call) =>
		isRecord(call) &&
		typeof call.tool === "string" &&
		call.tool.startsWith(prefix)
			? [
					{
						name: call.tool.slice(prefix.length),
						input: call.input,
						failed: call.status !== "completed",
					},
				]
			: [],
	);
}

/** OpenCode 2.x as an ACP agent. */
export const OPENCODE_ACP_AGENT: AcpAgent = {
	label: "OpenCode",
	args: () => ["acp"],
	model: "session",
	nestedToolCalls: opencodeNestedToolCalls,
};

/**
 * The major version of an `opencode` executable: `opencode v2.0.22` or
 * `1.19.2` on stdout. Undefined when it cannot tell.
 */
export async function opencodeMajor(
	executable: string,
): Promise<number | undefined> {
	const path = await resolveBin(executable);
	if (!path) return undefined;
	try {
		const out = await probe([path, "--version"]);
		const major = firstLine(out.stdout)?.match(/(\d+)\.\d+/)?.[1];
		return major === undefined ? undefined : Number(major);
	} catch {
		return undefined;
	}
}
