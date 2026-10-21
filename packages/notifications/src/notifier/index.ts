/** The notifier: the rules that decide whom to tell, about what, and on which screen. */

export { createNotifier } from "./notifier";
export {
	engineRunEvents,
	oneSenderPerSpace,
	type RunEvent,
	type RunEventSource,
	type SenderFacts,
	spaceAudience,
} from "./sources";
