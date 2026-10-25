/**
 * The live cache: the one follower of a Host for both apps. What a screen
 * reads again when a stream says something changed, the notices it shows
 * and the notifications it takes away (`ShownNotifications`: each app's
 * adapter), an answered Gate out of the inbox, and one run's stream.
 */

export type { EntryFold, LiveRun } from "./run-state";
export type { ListedNotification, Notice, ShownNotifications } from "./shown";
export { useAnswerGate } from "./use-answer-gate";
export { useFollowHost } from "./use-follow-host";
export type { HostApi } from "./use-live-cache";
export { useLiveRun } from "./use-live-run";
