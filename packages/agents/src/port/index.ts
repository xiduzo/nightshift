/**
 * The port: the harness-agnostic contract between the engine and an agent
 * harness or a decider. Pure types, the shell quoting the port's
 * `takeOverCommand` promises, and how a session's contributions fold into its
 * input. Light and browser-safe.
 */
export { foldContributions } from "./contributions";
export { shellQuote, shellQuoteAlways } from "./shell-quote";
export type {
	AgentErrorKind,
	AgentEvent,
	AgentHarness,
	AgentHarnessName,
	AgentSessionInput,
	AgentUsage,
	BridgedTool,
	CostSource,
	Decider,
	DeciderName,
	DecisionInput,
	DecisionResult,
	Effort,
	HarnessName,
	McpServerConfig,
	PermissionMode,
	SessionContribution,
	SessionLimit,
	StepReportOutcome,
	StepReportSpec,
	ValueInput,
	ValueResult,
} from "./types";
