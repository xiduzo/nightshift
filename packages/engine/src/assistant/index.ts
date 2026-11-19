/** What the answers of Night Shift's own agents cost: kept per answer, read for the Spend page, shared with the Host that keeps their Space. `wireAssistant` binds the use cases to their ports. */

export {
	type AnswerCost,
	HELP_AGENTS,
	type HelpAgent,
	type SentAnswerCost,
	type ServedAnswerCost,
} from "./domain/answer-costs";
export { wireAssistant } from "./wire";
