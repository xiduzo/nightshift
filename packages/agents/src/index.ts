/**
 * `@nightshift/agents`: the package API, composed from the barrels of its
 * verticals. This root brings every harness and decider; their TanStack
 * packages load on first use. The engine uses the light entries
 * (`./types`, `./harness-facts`, `./pricing`, `./tools`) instead.
 */
export {
	type AuthoringPort,
	type AuthoringRun,
	type AuthoringRunStep,
	type ChatExchange,
	chatCanUseTools,
	chatTurn,
	chooseProject,
	explainRun,
	resumesOnAnotherModel,
	type SuggestFieldInput,
	serveTools,
	suggestField,
	type TerminalPort,
	type TerminalProject,
	terminalResources,
	terminalTools,
} from "./assistant";
export {
	type DeciderView,
	deciderViews,
	type TanstackDeciderOptions,
	tanstackDecider,
} from "./decider";
export { type CliCheck, checkCustomAgent } from "./doctor";
export {
	ACP_DEFAULT_MODEL,
	type AcpAgentName,
	type AcpHarnessOptions,
	acpHarness,
	type ClaudeCodeHarnessOptions,
	type ClaudeCodeProcessOptions,
	type CodexHarnessOptions,
	checkHarness,
	claudeCodeHarness,
	codexHarness,
	customAcpHarness,
	type GrokBuildHarnessOptions,
	grokBuildHarness,
	type HarnessModels,
	type HarnessView,
	harnessFacts,
	harnessModels,
	harnessViews,
	type OpencodeHarnessOptions,
	opencodeHarness,
	runPiAcp,
} from "./harnesses";
export type {
	AgentErrorKind,
	AgentEvent,
	AgentHarness,
	AgentHarnessName,
	AgentSessionInput,
	AgentUsage,
	Decider,
	DeciderName,
	DecisionInput,
	DecisionResult,
	Effort,
	HarnessName,
	McpServerConfig,
	PermissionMode,
	StepReportOutcome,
	StepReportSpec,
	ValueInput,
	ValueResult,
} from "./port";
export {
	type CostSource,
	type PriceUpdates,
	startPriceUpdates,
} from "./pricing";
export {
	type InstalledSkill,
	installedSkills,
} from "./skills";
export {
	type CliToolCheck,
	checkCli,
	type McpTestResult,
	type McpToolInfo,
	pathPrograms,
	testMcpServer,
} from "./tools";
