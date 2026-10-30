/**
 * Every name the export writes: the attributes on spans and metric points,
 * the span names and the metric names, in one place. The OpenTelemetry
 * GenAI semantic conventions are still "Development" status: when they
 * change, this file changes, and a dashboard reads one list.
 */

/** Attribute keys. `gen_ai.*` from the GenAI conventions, the rest Night Shift's own. */
export const ATTR = {
	projectId: "nightshift.project.id",
	flowId: "nightshift.flow.id",
	runId: "nightshift.run.id",
	/** The run again, as the GenAI conventions name a conversation. */
	conversationId: "gen_ai.conversation.id",
	stepId: "nightshift.step.id",
	nodeId: "nightshift.node.id",
	nodeKind: "nightshift.node.kind",
	visit: "nightshift.step.visit",
	outcome: "nightshift.step.outcome",
	agent: "nightshift.agent",
	model: "gen_ai.request.model",
	operation: "gen_ai.operation.name",
	toolName: "gen_ai.tool.name",
	deviceId: "nightshift.device.id",
	trigger: "nightshift.run.trigger",
	status: "nightshift.run.status",
	reason: "nightshift.run.reason",
	resumed: "nightshift.run.resumed",
	gateWaitMs: "nightshift.gate.wait_ms",
	waitReason: "nightshift.wait.reason",
	/** On metric points: how sure a cost is (`billed`, `estimated`, `unknown`). */
	basis: "basis",
	/** On `nightshift.tokens`: `input`, `output`, `cache_read`, `cache_write`. */
	tokenType: "type",
	/** On `nightshift.run.outcome`: how the run ended. */
	endReason: "end_reason",
	/** On `nightshift.score` and `nightshift.pr.outcome`. */
	score: "nightshift.score.name",
	scoreLabel: "nightshift.score.label",
	prOutcome: "outcome",
	serviceName: "service.name",
	serviceInstance: "service.instance.id",
} as const;

/** The GenAI operation of a span (`gen_ai.operation.name`), as the conventions spell it. */
export const OPERATION = {
	workflow: "invoke_workflow",
	agent: "invoke_agent",
	tool: "execute_tool",
} as const;

/** Metric names, with their units. */
export const METRIC = {
	runDuration: { name: "nightshift.run.duration", unit: "s" },
	stepDuration: { name: "nightshift.step.duration", unit: "s" },
	cost: { name: "nightshift.run.cost_usd", unit: "{USD}" },
	tokens: { name: "nightshift.tokens", unit: "{token}" },
	retries: { name: "nightshift.retries", unit: "{step}" },
	gateWait: { name: "nightshift.gate.wait", unit: "s" },
	runOutcome: { name: "nightshift.run.outcome", unit: "{run}" },
	prOutcome: { name: "nightshift.pr.outcome", unit: "{pull_request}" },
	score: { name: "nightshift.score", unit: "{score}" },
} as const;

/** The name of the service every span and point comes from. */
export const SERVICE_NAME = "nightshift";

/** The instrumentation scope of the tracer and the meter. */
export const SCOPE_NAME = "@nightshift/telemetry";
