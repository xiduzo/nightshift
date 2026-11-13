/**
 * The open Gates on this phone: the Gates of every Space you are in, kept
 * live; one Gate in full to answer it (on its own screen and in the Needs
 * you queue), its links, its actions and its run's transcript; the cards
 * of the options to choose from; the row of one Gate that every screen
 * shows; and the share of a run's take-over command.
 */

export { ChoiceCards } from "./choice-cards";
export { GateActionsScreen } from "./gate-actions-screen";
export { GateBriefing, type GateSent } from "./gate-briefing";
export { GateLinkScreen } from "./gate-link-screen";
export { GateRow } from "./gate-row";
export { GateAnswerScreen } from "./gate-screen";
export { TranscriptScreen } from "./transcript-screen";
export { useInbox } from "./use-inbox";
export { useShareTakeOver } from "./use-share-take-over";
