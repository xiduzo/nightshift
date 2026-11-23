/**
 * The harnesses: one folder per harness (`claude-code/`, `codex/`,
 * `opencode/`, `grok-build/`, `acp/` for every agent that speaks ACP), the
 * facts of each harness as pure data (`facts-table/`), the registry of
 * one record per harness (`registry.ts`, `facts.ts`), and the skills each
 * harness can run (`skills/`).
 */
export {
	type AcpHarnessOptions,
	acpHarness,
	customAcpHarness,
	runPiAcp,
} from "./acp";
export { putAgentBinsOnPath } from "./bin-path";
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
export {
	ACP_DEFAULT_MODEL,
	type AcpAgentName,
} from "./facts-table";
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
export {
	type InstalledSkill,
	installedSkills,
} from "./skills";
