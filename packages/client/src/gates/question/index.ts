/** What a Gate shows: its question as parts, with its links and as plain text, and its brief. */

export {
	type BriefView,
	briefView,
	choiceLine,
	WRITTEN_BY_NIGHT_SHIFT,
} from "./brief";
export type { GateLink } from "./links";
export { plainText } from "./plain-text";
export { type ContextItem, gateParts, parseGateQuestion } from "./question";
