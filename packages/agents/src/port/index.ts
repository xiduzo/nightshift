/**
 * The port: the harness-agnostic contract between the engine and an agent
 * harness or a decider. Pure types, and the shell quoting the port's
 * `takeOverCommand` promises. Light and browser-safe.
 */
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
	CustomHarnessName,
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
} from "./types";
