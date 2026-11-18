/** What the assistant's work changes: a suggestion applied to a draft with its preview, and the diff between a draft and a proposal. */

export {
	applySuggestion,
	argumentChanges,
	type Change,
	inputChanges,
	type NamedChange,
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
} from "./apply";
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
