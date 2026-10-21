/**
 * The harnesses: one folder per harness (`claude-code/`, `codex/`,
 * `opencode/`, `grok-build/`, `acp/` for every agent that speaks ACP), and
 * the registry of one record per harness (`registry.ts`, `facts.ts`).
 */
export {
	ACP_AGENTS,
	ACP_DEFAULT_MODEL,
	type AcpAgentName,
	type AcpHarnessOptions,
	acpAgentHarness,
	acpHarness,
	acpPermission,
	customAcpHarness,
	isAcpAgent,
	runPiAcp,
} from "./acp";
export {
	type ClaudeCodeHarnessOptions,
	type ClaudeCodeProcessOptions,
	claudeCodeHarness,
	cliAllowRules,
} from "./claude-code";
export {
	type CodexHarnessOptions,
	type CodexPolicy,
	codexHarness,
	codexPolicy,
} from "./codex";
export {
	HARNESS_FACTS,
	HARNESS_LABELS,
	HARNESS_TAKE_OVER,
	harnessFacts,
	harnessLabel,
	harnessNoun,
} from "./facts";
export {
	type GrokBuildHarnessOptions,
	grokBuildHarness,
	grokPolicy,
} from "./grok-build";
export type { HarnessAdapter } from "./harness-record";
export {
	type OpencodeHarnessOptions,
	opencodeHarness,
	opencodePermission,
} from "./opencode";
export {
	checkHarness,
	HARNESS_ADAPTERS,
	type HarnessModels,
	type HarnessView,
	harnessModels,
	harnessViews,
} from "./registry";
