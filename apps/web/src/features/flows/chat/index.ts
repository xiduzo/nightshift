/** The chat about a flow: the thread, its proposals and the panel. */

export {
	type ChatLink,
	chatAboutMove,
	chatAboutRun,
	chatAboutSaving,
	chatSearch,
	parseChatLink,
} from "./chat-link";
export { FlowChatPanel } from "./chat-panel";
export { ProposalBar } from "./proposal-bar";
export { proposalCanvas, summaryLabels } from "./proposal-canvas";
export { useChatPanel } from "./use-chat-panel";
