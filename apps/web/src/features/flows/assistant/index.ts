/**
 * The assistant in the editor: who answers, the message box, and Suggest on a
 * field.
 */

export { type AgentChoice, requestAgent } from "./agent-choice";
export { AgentMenus, type AgentMenusProps } from "./agent-picker";
export {
	ArgumentsSuggest,
	CommandSuggest,
	DescriptionSuggest,
	ExpressionSuggest,
	InputsSuggest,
	isSuggestKey,
	OutcomesSuggest,
	OutputSuggest,
	PromptSuggest,
	type PromptTarget,
	RulesSuggest,
	SetSuggest,
	selectionOf,
} from "./field-helpers";
export {
	type FlowAssistant,
	FlowAssistantContext,
	replaceDraft,
	useFlowAssistant,
} from "./flow-assistant";
export type { PickedAnswer } from "./picked-answer";
export { PromptInput } from "./prompt-input";
export { Suggestions } from "./suggestions";
export { useBuiltinPick } from "./use-builtin-pick";
