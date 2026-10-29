/**
 * The harnesses: one folder per harness (`claude-code/`, `codex/`,
 * `opencode/`, `grok-build/`, `acp/` for every agent that speaks ACP), and
 * the registry of one record per harness (`registry.ts`, `facts.ts`).
 */
export {
	ACP_DEFAULT_MODEL,
	type AcpAgentName,
	type AcpHarnessOptions,
	acpHarness,
	customAcpHarness,
	runPiAcp,
} from "./acp";
export {
	type ClaudeCodeHarnessOptions,
	type ClaudeCodeProcessOptions,
	claudeCodeHarness,
} from "./claude-code";
export {
	type CodexHarnessOptions,
	codexHarness,
} from "./codex";
export { harnessFacts } from "./facts";
export { HARNESS_FACTS } from "./facts-table";
export {
	type GrokBuildHarnessOptions,
	grokBuildHarness,
} from "./grok-build";
export {
	type OpencodeHarnessOptions,
	opencodeHarness,
} from "./opencode";
export {
	checkHarness,
	type HarnessModels,
	type HarnessView,
	harnessModels,
	harnessViews,
} from "./registry";
