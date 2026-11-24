/**
 * Prompt catalog and pure assistant rules shared by chat and tools.
 */

export { bareToolName } from "./domain/activity";
export {
	toolAnnotations,
	toolsOf,
} from "./domain/builtin-tools";
export {
	type ChatExchange,
	chatFollowUpPrompt,
	chatPrompt,
} from "./domain/chat-prompt";
export { chatCanUseTools, resumesOnAnotherModel } from "./domain/chat-rules";
export type { AgentCheck } from "./domain/check-agent";
export { CHECK_LIMITS, CHECK_PROMPT } from "./domain/check-limits";
export { explanationPrompt } from "./domain/explain-prompt";
export {
	LEARN_OUTPUT,
	learnFromRunPrompt,
	type RunLearnings,
	reportedLearnings,
} from "./domain/learn-prompt";
