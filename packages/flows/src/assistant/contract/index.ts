/** The assistant's contract: a suggestion for a field, a chat about a flow, an explanation, and how the assistant cites a step. */

export {
	type AssistantAgent,
	type AssistantScope,
	type AssistantService,
	type AssistantUsage,
	type ChatEvent,
	type ChatRequest,
	chatMessage,
	chatRequestSchema,
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
	suggestionRequestSchema,
	suggestionSchema,
	type TextRange,
} from "./assistant";
export { citedStepId, stepCitation } from "./citation";
