import type { OPENCODE_MODELS } from "@tanstack/ai-opencode";
import { baseCheck, type CliCheck } from "../../doctor";
import { OPENCODE_FACTS } from "../facts-table";
import type { HarnessAdapter } from "../harness-record";

/**
 * The version, as `x.y.z`. Both OpenCode 1.x and 2.x work: 2.x runs over
 * ACP (see `acp.ts`).
 */
async function opencodeCheck(bin: string): Promise<CliCheck> {
	const { resolved, ...check } = await baseCheck(bin, "OpenCode");
	if (!resolved || check.problem) return check;
	// "opencode v2.0.22" or "1.19.2".
	const version =
		check.version?.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? check.version;
	return { ...check, version };
}

/**
 * The models `@tanstack/ai-opencode` knows. A copy, so the registry does
 * not load the adapter: the type fails when the package's list changes.
 */
const MODELS = [
	"anthropic/claude-opus-4-5",
	"anthropic/claude-sonnet-4-5",
	"openai/gpt-5.2",
	"openai/gpt-5.1-codex",
	"google/gemini-3-pro-preview",
	"opencode/claude-sonnet-4-5",
	"opencode/gpt-5.1-codex",
] as const satisfies typeof OPENCODE_MODELS;

/** OpenCode in the harness registry. */
export const OPENCODE_ADAPTER: HarnessAdapter = {
	...OPENCODE_FACTS,
	models: MODELS,
	check: opencodeCheck,
};
