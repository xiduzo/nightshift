/**
 * The assistant's contract (suggestions for a field, and a chat about a
 * flow), and the pure logic both sides share: the authoring guide, the
 * check of a proposal, and the diff the canvas shows.
 */

export {
	applySuggestion,
	type Change,
	newVariables,
	type OutputFieldChange,
	outputChanges,
	type WriteChange,
	writeChanges,
} from "./apply";
export {
	type AssistantScope,
	type AssistantService,
	type AssistantUsage,
	type ChatEvent,
	type ChatRequest,
	chatRequestSchema,
	type FlowProposal,
	type Suggestion,
	type SuggestionEvent,
	type SuggestionKind,
	type SuggestionRequest,
	suggestionRequestSchema,
	suggestionSchema,
	type TextRange,
} from "./assistant";
export {
	diffFlows,
	type FlowDiff,
	type FlowDiffSummary,
	flowDiffSummary,
	type ItemChange,
	type ListDiff,
	type NodeChange,
	type NodeMove,
} from "./diff";
export { flowAuthoringGuide } from "./guide";
export { type ProposalCheckOptions, proposalIssues } from "./proposal";
