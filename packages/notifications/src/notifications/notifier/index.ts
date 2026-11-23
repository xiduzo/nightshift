/** The notifier: the rules that decide whom to tell, about what, and on which screen. */

export { oneSenderPerSpace, type SenderFacts } from "./domain/senders";
export { type RunEventSource, wireNotifier } from "./wire";
