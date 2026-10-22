/**
 * The phone push contract: what a push from the Host names, so the phone
 * defines the same categories and channels and reads the same keys. The
 * Host's side is `EXPO_CATEGORY`, `EXPO_ANDROID_CHANNEL`, `gateKey` and
 * `runEndKey` in `@nightshift/notifications`. Both sides pin these values
 * in a test (`push.test.ts` here, `push-contract.test.ts` there): change
 * them together.
 */

/** The notification categories of a push. */
export const PUSH_CATEGORY = {
	/** A lock-screen Gate with two options: Approve and Reject on the notification. */
	decide: "gate-decide",
	/** Any other Gate, and the end of quiet hours: a tap opens the app. */
	open: "gate-open",
	/** A run that finished or failed: a tap opens the run. */
	run: "run",
} as const;

/** The Android notification channels of a push: Gates and runs. */
export const PUSH_ANDROID_CHANNEL = { gates: "gates", runs: "runs" } as const;

/** The two buttons of `gate-decide`. Approve answers the first option, Reject the second. */
export const PUSH_ACTION = { approve: "approve", reject: "reject" } as const;

/** What a push the person sees is about. */
export const PUSH_MESSAGE_KINDS = [
	"gate-opened",
	"run-finished",
	"run-failed",
	"gates-waiting",
] as const;
export type PushMessageKind = (typeof PUSH_MESSAGE_KINDS)[number];

/**
 * Whether a notification key names a Gate (`runId:stepId`, as `gateKey`
 * makes it). A run's end (`runId:end:<seq>`) has a third part, and the
 * end of quiet hours (`waiting:<ms>`) is not a Gate.
 */
export function isGateKey(key: string): boolean {
	const parts = key.split(":");
	return (
		parts.length === 2 &&
		parts[0] !== "" &&
		parts[1] !== "" &&
		parts[0] !== "waiting"
	);
}
