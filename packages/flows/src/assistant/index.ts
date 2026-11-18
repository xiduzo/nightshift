/**
 * The assistant's contract (suggestions for a field, and a chat about a
 * flow), and the pure logic both sides share: the authoring guide, the
 * check of a proposal, and the diff the canvas shows.
 */

export {
	applySuggestion,
	argumentChanges,
	type Change,
	diffFlows,
	type FlowDiff,
	type FlowDiffSummary,
	flowDiffSummary,
	type ItemChange,
	inputChanges,
	type ListDiff,
	type NamedChange,
	type NodeChange,
	type NodeMove,
	newVariables,
	type OutcomeChange,
	type OutputFieldChange,
	outcomeChanges,
	outputChanges,
	ruleChanges,
	suggestedCommandOf,
	takesSuggestion,
	type WriteChange,
	writeChanges,
} from "./changes";
export {
	type AssistantAgent,
	type AssistantScope,
	type AssistantService,
	type AssistantUsage,
	type ChatEvent,
	type ChatRequest,
	chatMessage,
	chatRequestSchema,
	citedStepId,
	type ExplainRequest,
	type ExplanationEvent,
	explainRequestSchema,
	type FlowProposal,
	isFlowSuggestion,
	type SuggestedOutcome,
	type Suggestion,
	type SuggestionEvent,
	type SuggestionKind,
	type SuggestionRequest,
	stepCitation,
	suggestionRequestSchema,
	suggestionSchema,
	type TextRange,
} from "./contract";
export { flowAuthoringGuide } from "./guide";
export { proposalIssues } from "./proposal";
